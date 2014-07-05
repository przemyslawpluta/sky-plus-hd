var Client = require('node-ssdp').Client,
   q = require('q'),
   SkyPlusHDBox = require('./skyPlusHDBox'),
   settings = require('../settings');

q.longStackSupport = true;

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
      }, settings.findTimeout);

   }

   this.find = function find() {

      var deferred = q.defer(),
         findServices = [settings.Services.SkyRC, settings.Services.SkyBrowse],
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
