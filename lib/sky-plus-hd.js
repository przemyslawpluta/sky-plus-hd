var http = require('http'),
   events = require('events'),
   util = require('util'),
   Client = require('node-ssdp').Client,
   q = require('q'),
   _ = require('underscore'),
   request = require('request'),
   xml2js = require('xml2js'),
   ip = require('ip'),
   xml = require('xml');

_.str = require('underscore.string');
q.longStackSupport = true;

var SkyPlusHDSettings = {
   findTimeout: 5000,
   renewSubscriptionInterval: 60000,
   Services: {
      SkyServe    : 'urn:schemas-nds-com:device:SkyServe:2',
      SkyBook     : 'urn:schemas-nds-com:service:SkyBook:2',
      SkyBrowse   : 'urn:schemas-nds-com:service:SkyBrowse:2',
      SkyControl  : 'urn:schemas-nds-com:device:SkyControl:2',
      SkyPlay     : 'urn:schemas-nds-com:service:SkyPlay:2',
      SkyCM       : 'urn:schemas-nds-com:service:SkyCM:2',
      SkyRC       : 'urn:schemas-nds-com:service:SkyRC:2'
   }
};

var skyBoxRequest = request.defaults({
   encoding: 'utf8',
   headers: { 'User-Agent': 'SKY_skyplus' },
   timeout: 5000
});

var xmlParser = function xmlParser(xml) {

   'use strict';

   function cleanupXml(o) {
      var ret;

      if (!_.isObject(o) && _.isArray(o)) {
         ret = [];
      } else if (_.isObject(o)) {
         ret = {};
      } else {
         return o;
      }

      _.each(o, function each(v, k) {
         if (!_.isObject(v) && !_.isArray(v)) {
            ret[k] = v;
         } else if (_.isArray(v)) {
            if (v.length === 1) {
               ret[k] = cleanupXml(v[0]);
            } else {
               ret[k] = cleanupXml(v);
            }
         } else if (_.isObject(v)) {
            ret[k] = cleanupXml(v);
         }
      });

      return ret;
   }

   var deferred = q.defer();

   xml2js.parseString(xml, function parse(err, results) {
      if (err) {
         deferred.reject(err);
      } else {
         deferred.resolve(cleanupXml(results));
      }
   });

   return deferred.promise;
};

var SkyPlusHDPlanner = function SkyPlusHDPlanner(box) {

   'use strict';

   var _this = this;

   this.updateID = undefined;

   function parsePlannerItem(data) {

      return {
         resource: data.res._,
         id: data['vx:X_recordingID'],
         size: parseInt(data.res.$.size),
         title: data['dc:title'],
         description: data['dc:description'],
         channel: {
            num: parseInt(data['upnp:channelNr']),
            name: data['upnp:channelName'],
            id: data['upnp:channelID'] ? data['upnp:channelID']._ : undefined, // Could be a download
         },
         lastPlaybackPosition: parseInt(data['vx:X_lastPlaybackPosition']),
         isViewed: (data['vx:X_isViewed'] ==='1'),
         isPlaying: (data['vx:X_isPlaying'] === '1'),
         season: (data['vx:X_seasonNumber'] !== '0') ? parseInt(data['vx:X_seasonNumber']) : undefined,
         episode: (data['upnp:episodeNumber'] !== '0') ? parseInt(data['upnp:episodeNumber']) : undefined,
         scheduled: {
            start: data['upnp:scheduledStartTime'],
            end: data['upnp:scheduledEndTime'],
            duration: data['upnp:scheduledDuration']
         },
         recorded: {
            start: data['upnp:recordedStartDateTime'],
            duration: data['upnp:recordedDuration']
         },
         booked: {
            time: data['vx:X_bookingTime'],
            type: data['vx:X_bookingType'],
            active: data['vx:X_bookingActive'],
            keep: data['vx:X_bookingKeep'],
         },
         flags: {
            isHd: (data['vx:X_flags'].$.hd === '1'),
            hasForeignSubtitles: (data['vx:X_flags'].$.hasForeignSubtitles === '1'),
            hasAudioDesc: (data['vx:X_flags'].$.hasAudioDesc === '1'),
            widescreen: (data['vx:X_flags'].$.widescreen === '1'),
            isLinked: (data['vx:X_flags'].$.isLinked === '1'),
            currentSeries: (data['vx:X_flags'].$.currentSeries === '1'),
            is3D: (data['vx:X_flags'].$.is3D === '1'),
            isAdult: (data['vx:X_flags'].$.isAdult === '1'),
            isFirstRun: (data['vx:X_flags'].$.firstRun === '1')
          }
      };
   }

   this.getPlannerItems = function getPlannerItems(offset) {
      if (!offset) { offset = 0; }

      var deferred = q.defer(),
         soapPayload = {
            ObjectID: 3,
            BrowseFlag: 'BrowseDirectChildren',
            Filter: '*',
            StartingIndex: offset,
            RequestedCount: 25,
            SortCriteria: []
         };

      box.soapRequest(SkyPlusHDSettings.Services.SkyBrowse, 'Browse', soapPayload).then(function resolve(response) {
         if (!offset) { _this.updateID = +response.UpdateID; }

         var items = _.map(response.Result['DIDL-Lite'].item, parsePlannerItem);

         if (+response.NumberReturned+offset < +response.TotalMatches) {
            _this.getPlannerItems(offset+soapPayload.RequestedCount).then(function resolve(items2) {
               items = items.concat(items2);
               deferred.resolve(items);
            }).done();
         } else {
            deferred.resolve(items);
         }
      }).done();

      return deferred.promise;
   };

   this.findResource = function findResource(res) {

      var deferred = q.defer();

      _this.getPlannerItems().then(function resolve(items) {
         var found = _.findWhere(items, { resource: res });
         if (found) {
            deferred.resolve(found);
         } else {
            deferred.reject('Resource not found in planner items');
         }
      }).fail(function fail() {
         deferred.reject('Failed to retreive planner items');
      }).done();

      return deferred.promise;
   };

};

var SkyPlusHDChannel = function SkyPlusHDChannel(skyBox, properties) {

   'use strict';

   properties = properties || {};

   this.name = properties.name;
   this.nameLong = properties.nameLong || properties.name;
   this.number = properties.number;
   this.id = properties.id;
   this.idHex = this.id ? (+this.id).toString(16).toUpperCase() : undefined;

   this.view = function view() {
      var deferred = q.defer();

      skyBox.setChannel(this.number).fail(function fail(err) {
         deferred.reject(err);
      }).then(function resolve() {
         deferred.resolve();
      }).done();

      return deferred.promise;
   };

};

var SkyPlusHDState = function SkyPlusHDState() {

   'use strict';

   var _this = this, state = {};

   this.set = function set(stateObj) {
      var changed = {}, hasChanged = false;

      _.each(stateObj, function each(val, key) {
         if (state[key] !== val) {
            hasChanged = true;
            changed[key] = val;
            state[key] = val;
         }
      });

      if (hasChanged) {
         _.each(changed,function each(val, key) {
            _this.emit('change:' + key, val);
         });

         console.log(changed);
      }

      _this.emit('change', changed);
   };
};

util.inherits(SkyPlusHDState, events.EventEmitter);

var SkyPlusHDBox = function SkyPlusHDBox(options) {

   'use strict';

   var _this = this;

   options = this.options = _.extend({
      ip: null,
      port: null,
      xml: null,
      ownIp: ip.address(),
      ownPort: 65432,
      regionCode: '4101-1'
   }, options, { port: 49153 });

   this.description = util.format('SkyPlusHD box at [%s:%d]', options.ip, options.port);

   this.details = {
      modelDescription: null,
      modelName: null,
      modelNumber: null,
      friendlyName: null,
      manufacturer: null
   };

   this.services = {};
   this.planner = new SkyPlusHDPlanner(_this);
   this.state = new SkyPlusHDState();
   this.currentChannel = 0;
   this.sid = undefined;
   this.listeningSocket = undefined;

   this.fetchDescriptionXml = function fetchDescriptionXml(url) {
      var deferred = q.defer();

      skyBoxRequest(url, function resolve(err, msg, body) {
         if (err) {
            deferred.reject(new Error(err));
         } else {
            xmlParser(body).fail(function fail(err) {
               deferred.reject(err);
            }).then(function resolve(result) {

               _this.details = {
                  modelDescription: result.root.device.modelDescription,
                  modelName: result.root.device.modelName,
                  modelNumber: result.root.device.modelNumber,
                  friendlyName: result.root.device.friendlyName,
                  manufacturer: result.root.device.manufacturer
               };

               _this.description = util.format('%s %s [model: %s] [software: %s] at %s:%d', _this.details.manufacturer, _this.details.modelName, _this.details.modelDescription, _this.details.modelNumber, options.ip, options.port);

               _.each(result.root.device.serviceList.service, function each(serviceNode) {
                  _this.services[serviceNode.serviceType] = {
                     serviceType: serviceNode.serviceType,
                     serviceId: serviceNode.serviceId,
                     SCPDURL: serviceNode.SCPDURL,
                     controlURL: serviceNode.controlURL,
                     eventSubURL: serviceNode.eventSubURL
                  };
               });

               deferred.resolve();

            }).done();
         }
      });

      return deferred.promise;
   };

   var subscribe = function SkyPlusHDBoxSubscribe() {

      var deferred = q.defer();

      if (!_this.sid) { listenForNotifications(); }

      console.log((_this.sid) ? 'Renewing subscription '+_this.sid : 'Requesting new subscription');

      var requestOptions = {
         url: util.format('http://%s:%d%s', options.ip, _this.options.port, _this.services[SkyPlusHDSettings.Services.SkyPlay].eventSubURL),
         method: 'SUBSCRIBE',
         headers: (_this.sid) ? { sid: _this.sid }: {
            callback: util.format('<http://%s:%d>', options.ownIp,options.ownPort),
            nt: 'upnp:event'
         }
      };

      skyBoxRequest(requestOptions, function resolve(err, msg, body) {
         if (err) {
            deferred.reject(err);
            console.log('error 1 %s', JSON.stringify(err));
            setTimeout(subscribe, SkyPlusHDSettings.renewSubscriptionInterval);
         } else if (msg.statusCode !== 200) {
            deferred.reject(new Error('Failed to subscribe, http status ' + msg.statusCode));
            console.log('error 2%s', JSON.stringify(err));
         } else {
            console.log(_this.sid ? 'Renewed subscription ' + msg.headers.sid : 'Created new subscription ' + msg.headers.sid);

            _this.sid = msg.headers.sid;

            deferred.resolve({
               sid: msg.headers.sid,
               expires: new Date().valueOf() + (parseInt(msg.headers.timeout.replace(/[^0-9]/g,''), 10) * 1000),
               timeout: msg.headers.timeout
            });

            setTimeout(function timeout() {
               subscribe().fail(function fail() {
                  console.log('Failed to renew subscription ' + _this.sid);
                  _this.sid = undefined;
                  subscribe();
               });
            }, SkyPlusHDSettings.renewSubscriptionInterval);
         }
      });

      return deferred.promise;
   };

   var listenForNotifications = function SkyPlusHDBoxListenForNotifications() {
      if (_this.listeningSocket)  {
         return console.log('Notification listener already exists');
      } else {
         console.log('Opening notification listener');
      }

      _this.listeningSocket = http.createServer(function resolve(req, res) {
         if (_this.sid && req.headers.sid !== _this.sid) {
            res.writeHead(404,{'Content-Type':'text/plain'});
            return res.end();
         }

         var chunks = '';

         req.on('data', function data(chunk) { chunks += chunk; });

         req.on('end', function end() {

            xmlParser(chunks).then(function resolve(result) {
               xmlParser(result['e:propertyset']['e:property'].LastChange).then(function resolve(results) {

                  var ev = {
                     TransportState: results.Event.InstanceID.TransportState.$.val,
                     CurrentTrackURI: results.Event.InstanceID.CurrentTrackURI.$.val,
                     TransportPlaySpeed: results.Event.InstanceID.TransportPlaySpeed.$.val,
                     AVTransportURI: results.Event.InstanceID.AVTransportURI.$.val,
                     TransportStatus: results.Event.InstanceID.TransportStatus.$.val,
                  };

                  _this.emit('stateChanged', ev);
                  _this.state.set(ev);

               }).done();
            }).done();

         });

         res.writeHead(200,{'Content-Type':'text/plain'});
         res.end('OK');

      }).listen(options.ownPort);

      console.log('Opened notification listener');

   };

   var generateRequestXML = function generateRequestXML(service, method, payload) {

      var transformedPayload = [{'_attr':{ 'xmlns:u': service }}];

      _.each(payload,function each(val, key) {
         var obj = {};
         obj[key] = val;
         transformedPayload.push(obj);
      });

      var sBodyContent = {};
      sBodyContent['u:'+method] = transformedPayload;

      var json = [{
         's:Envelope': [
            {'_attr': {
               's:encodingStyle':'http://schemas.xmlsoap.org/soap/encoding/',
               'xmlns:s':'http://schemas.xmlsoap.org/soap/envelope/'
            }},
            {'s:Body': [sBodyContent]}
         ]}
      ];
      return '<?xml version="1.0" encoding="utf-8"?>' + xml(json);
   };

   this.soapRequest = function soapRequest(service, method, payload) {
      var deferred = q.defer(),
         xml = generateRequestXML(service, method, payload);

      var httpOptions = {
         url: util.format('http://%s:%d%s', _this.options.ip, _this.options.port, _this.services[service].controlURL),
         method: 'POST',
         headers: {
            'SOAPACTION': '"'+service + '#'+method+'"',
            'Content-Type': 'text/xml; charset="utf-8"',
         },
         body: xml
      };

      skyBoxRequest(httpOptions, function resolve(err, msg, body) {
         if (err) {
            deferred.reject(err);
         } else {
            xmlParser(body).fail(function fail(err) {
               deferred.reject(err);
            }).then(function resolve(result) {
               var obj = result['s:Envelope']['s:Body'][util.format('u:%sResponse', method)];

               if (!obj) { return deferred.reject('Error - transport may be locked'); }

               var outObj = {}, i;

               for (i in obj) {
                  if ( i === '$' || i === 'Result') { continue; }
                  outObj[i] = obj[i];
               }

               if (obj.Result) {
                  xmlParser(obj.Result).fail(function fail(err) {
                     deferred.reject(err);
                  }).then(function resolve(result) {
                     outObj.Result = result;
                     deferred.resolve(outObj);
                  }).done();
               } else {
                  deferred.resolve(outObj);
               }

            }).done();
         }
      });

      return deferred.promise;
   };

   this.setChannel = function setChannel(properties) {
      var deferred = q.defer();
      if (!_.isObject(properties)) { properties = {number:properties}; }

      findChannel(properties).fail(function fail(err) {
         deferred.resolve(err);
      }).then(function resolve(channel) {
         console.log('Changing channel to ' + channel.name + ' (' + channel.number + ')');

         var soapPayload = {
            InstanceID: 0,
            CurrentURI: util.format('xsi://%s', channel.idHex),
            CurrentURIMetaData:'NOT_IMPLEMENTED'
         };

         _this.soapRequest(SkyPlusHDSettings.Services.SkyPlay, 'SetAVTransportURI', soapPayload).fail(function fail(err) {
            deferred.reject(err);
         }).then(function resolve() {
            deferred.resolve();
         }).done();

      }).done();

      return deferred.promise;
   };

   this.channelUp = function channelUp() {

      var deferred = q.defer();

      _this.setChannel(_this.currentChannel.number + 1).fail(function fail(err) {
         deferred.reject(err);
      }).then(function resolve() {
         deferred.resolve();
      }).done();

      return deferred.promise;
   };

   this.channelDown = function channelDown() {

      var deferred = q.defer();

      _this.setChannel(_this.currentChannel.number - 1).fail(function fail(err) {
         deferred.reject(err);
      }).then(function resolve() {
         deferred.resolve();
      }).done();

      return deferred.promise;
   };

   this.play = function play() {
      var deferred = q.defer();
      var soapPayload = {
         InstanceID: 0,
         Speed: 1
      };

      _this.soapRequest(SkyPlusHDSettings.Services.SkyPlay, 'Play', soapPayload).fail(function fail(err) {
         deferred.reject(err);
      }).then(function resolve() {
         deferred.resolve();
      }).done();

      return deferred.promise;
   };

   this.pause = function pause() {
      var deferred = q.defer();
      var soapPayload = {
         InstanceID: 0,
         Speed: 1
      };

      _this.soapRequest(SkyPlusHDSettings.Services.SkyPlay, 'Pause', soapPayload).fail(function fail(err) {
         deferred.reject(err);
      }).then(function resolve() {
         deferred.resolve();
      }).done();

      return deferred.promise;
   };

   this.fwd = function fwd() {
      var deferred = q.defer();
      var soapPayload = {
         InstanceID: 0,
         Speed: 12
      };

      _this.soapRequest(SkyPlusHDSettings.Services.SkyPlay, 'Play', soapPayload).fail(function fail(err) {
         deferred.reject(err);
      }).then(function resolve() {
         deferred.resolve();
      }).done();

      return deferred.promise;
   };

   this.rew = function rew() {
      var deferred = q.defer();
      var soapPayload = {
         InstanceID: 0,
         Speed: -12
      };

      _this.soapRequest(SkyPlusHDSettings.Services.SkyPlay, 'Play', soapPayload).fail(function fail(err) {
         deferred.reject(err);
      }).then(function resolve() {
         deferred.resolve();
      }).done();

      return deferred.promise;
   };

   var findChannel = this.findChannel = function findChannel(properties) {
      var deferred = q.defer();

      getChannelList().fail(function fail(err) {
         deferred.reject(err);
      }).then(function resolve(channels) {
         var channel = _.findWhere(channels, properties);
         if (channel) {
            deferred.resolve(channel);
         } else {
            deferred.reject('Channel not found ' + JSON.stringify(properties));
         }
      }).done();

      return deferred.promise;
   };

   var getChannelList = this.getChannelList = _.memoize(function memoize() {
      var deferred = q.defer();

      request(util.format('http://tv.sky.com/channel/index/%s', options.regionCode), function resolve(err, msg, body) {
         if (err) { return deferred.reject(err); }
         var listData = JSON.parse(body),
            channels = _.map(listData.init.channels, function map(channelData) {
               return new SkyPlusHDChannel(_this,{
                  name: channelData.t,
                  nameLong: channelData.lcn || channelData.t,
                  number: channelData.c[1],
                  id: channelData.c[0]
               });
            });

         console.log(util.format('Loaded %d channel definitions', channels.length));
         deferred.resolve(channels);
      });

      return deferred.promise;
   });

   _this.state.on('change:CurrentTrackURI', function CurrentTrackURI(val) {
      if (val.match(/^file/)) {
         _this.planner.findResource(val).then(function resolve(item) {
            _this.emit('video',item);
            console.log('Now playing: ' + item.title);
         }).done();
      } else if (val.match(/^xsi:\/\/(.*)/)) {
         getChannelList().then(function resolve() {

            var channelHexIdMatch = val.match(/^xsi:\/\/(.*)/);
            findChannel({idHex:channelHexIdMatch[1]}).fail(function fail(err) {
               console.log(err);
            }).then(function resolve(channel) {
               if (!_this.currentChannel) { setTimeout(function timeout() { _this.emit('ready', channel); }, 5); }
               _this.currentChannel = channel;
               _this.emit('channelChanged', channel);
               console.log('Channel: ' + channel.name + ' (' + channel.number + ')');
            }).done();

         }).done();
      }

   });

   q.all(_.map(options.xml, function resolve(xmlUrl) {
      return _this.fetchDescriptionXml(xmlUrl);
   })).then(function resolve() {
      subscribe().then(function resolve() { _this.emit('init'); }).done();
   }).done();

};

util.inherits(SkyPlusHDBox, events.EventEmitter);

module.exports = function SkyPlusHD() {

   'use strict';

   function initialize(vals, resolve) {
      var skyRC = vals[0],
         skyBrowse = vals[1],
         skyBox = new SkyPlusHDBox({
            ip: skyRC.rinfo.address,
            port: skyRC.rinfo.port,
            xml: [skyRC.msg.LOCATION, skyBrowse.msg.LOCATION]
         });

      skyBox.on('init', function init() { resolve(skyBox); });
   }

   function discoverService(serviceUrn, callback) {

      var ssdp = new Client(), timeoutTimer;

      ssdp.on('response', function response(msg, status, rinfo) {

         clearTimeout(timeoutTimer);

         callback(null, { msg: msg, rinfo: rinfo });

      });

      ssdp.search(serviceUrn);

      timeoutTimer = setTimeout(function timeout() {
         callback(new Error('Timeout searching for service ' + serviceUrn));
      }, SkyPlusHDSettings.findTimeout);

   }

   this.find = function find() {

      var deferred = q.defer(),
         findServices = [SkyPlusHDSettings.Services.SkyRC, SkyPlusHDSettings.Services.SkyBrowse],
         vals = [];

      findServices.forEach(function items(item) {

         discoverService(item, function resp(err, data) {
            if (err !== null) { return deferred.reject(err); }

            vals.push(data);

            if (vals.length === findServices.length) { initialize(vals, deferred.resolve); }

         });

      });

      return deferred.promise;

   };

};
