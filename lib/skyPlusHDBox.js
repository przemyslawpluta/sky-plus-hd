var util = require('util'),
   http = require('http'),
   events = require('events'),
   q = require('q'),
   request = require('request'),
   ip = require('ip'),
   _ = require('underscore'),
   xml = require('xml'),
   SkyPlusHDPlanner = require('./skyPlusHD').Planner,
   SkyPlusHDChannel = require('./skyPlusHD').Channel,
   SkyPlusHDState = require('./skyPlusHD').State,
   xmlParser = require('./xmlParser'),
   settings = require('../settings');

q.longStackSupport = true;

var skyBoxRequest = request.defaults({
   encoding: 'utf8',
   headers: { 'User-Agent': 'SKY_skyplus' },
   timeout: 5000
});

function SkyPlusHDBox(options) {

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
         url: util.format('http://%s:%d%s', options.ip, _this.options.port, _this.services[settings.Services.SkyPlay].eventSubURL),
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
            setTimeout(subscribe, settings.renewSubscriptionInterval);
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
            }, settings.renewSubscriptionInterval);
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

         _this.soapRequest(settings.Services.SkyPlay, 'SetAVTransportURI', soapPayload).fail(function fail(err) {
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

      _this.soapRequest(settings.Services.SkyPlay, 'Play', soapPayload).fail(function fail(err) {
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

      _this.soapRequest(settings.Services.SkyPlay, 'Pause', soapPayload).fail(function fail(err) {
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

      _this.soapRequest(settings.Services.SkyPlay, 'Play', soapPayload).fail(function fail(err) {
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

      _this.soapRequest(settings.Services.SkyPlay, 'Play', soapPayload).fail(function fail(err) {
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

}

util.inherits(SkyPlusHDBox, events.EventEmitter);

module.exports = SkyPlusHDBox;
