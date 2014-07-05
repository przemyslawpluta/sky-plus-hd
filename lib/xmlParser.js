var xml2js = require('xml2js'),
   _ = require('underscore'),
   q = require('q');

q.longStackSupport = true;

module.exports = function xmlParser(xml) {

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
