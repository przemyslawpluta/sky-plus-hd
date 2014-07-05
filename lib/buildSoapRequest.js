var q = require('q'),
   settings = require('../settings');

q.longStackSupport = true;

module.exports = {

   state: function state(_this, options) {

      'use strict';

      return function build() {

         var deferred = q.defer(), soapPayload = { InstanceID: options[0], Speed: options[1] };

         _this.soapRequest(settings.Services.SkyPlay, options[2], soapPayload).fail(function fail(err) {
            deferred.reject(err);
         }).then(function resolve() {
            deferred.resolve();
         }).done();

         return deferred.promise;
      };

   },

   channel: function channel(_this, num) {

      'use strict';

      var deferred = q.defer();

      return function build() {

         num = num * -1;

         _this.setChannel(_this.currentChannel.number - num).fail(function fail(err) {
            deferred.reject(err);
         }).then(function resolve() {
            deferred.resolve();
         }).done();

         return deferred.promise;
      };

   }

};
