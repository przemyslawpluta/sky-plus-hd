var http = require('http'),
	util = require('util'),
	q = require('q'),
	xml = require('xml'),
	_ = require('underscore'),
	xmlParser = require('./xmlParser'),
   skyBoxRequest = require('./skyBoxRequest'),
	settings = require('../settings');

q.longStackSupport = true;

function listenForNotifications(_this, options) {

   'use strict';

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

}

function subscribe(_this, options) {

   'use strict';

   var deferred = q.defer();

   if (!_this.sid) { listenForNotifications(_this, options); }

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
         setTimeout(subscribe(_this, options), settings.renewSubscriptionInterval);
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
            subscribe(_this, options).fail(function fail() {
               console.log('Failed to renew subscription ' + _this.sid);
               _this.sid = undefined;
               subscribe(_this, options);
            });
         }, settings.renewSubscriptionInterval);
      }
   });

   return deferred.promise;
}

module.exports = {

	generateRequestXML: function generateRequestXML(service, method, payload) {

	   'use strict';

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
	},

	subscribe: subscribe,

};
