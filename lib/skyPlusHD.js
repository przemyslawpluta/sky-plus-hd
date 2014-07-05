var q = require('q'),
   _ = require('underscore'),
   events = require('events'),
   util = require('util'),
   settings = require('../settings');

q.longStackSupport = true;

function State() {

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
}

util.inherits(State, events.EventEmitter);

module.exports = {

   Planner: function Planner(box) {

      'use strict';

      var _this = this;

      this.updateID = undefined;

      function parsePlannerItem(data) {

         return {
            resource: data.res._,
            id: data['vx:X_recordingID'],
            size: parseInt(data.res.$.size, 10),
            title: data['dc:title'],
            description: data['dc:description'],
            channel: {
               num: parseInt(data['upnp:channelNr'], 10),
               name: data['upnp:channelName'],
               id: data['upnp:channelID'] ? data['upnp:channelID']._ : undefined, // Could be a download
            },
            lastPlaybackPosition: parseInt(data['vx:X_lastPlaybackPosition'], 10),
            isViewed: (data['vx:X_isViewed'] ==='1'),
            isPlaying: (data['vx:X_isPlaying'] === '1'),
            season: (data['vx:X_seasonNumber'] !== '0') ? parseInt(data['vx:X_seasonNumber'], 10) : undefined,
            episode: (data['upnp:episodeNumber'] !== '0') ? parseInt(data['upnp:episodeNumber'], 10) : undefined,
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

         box.soapRequest(settings.Services.SkyBrowse, 'Browse', soapPayload).then(function resolve(response) {
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
   },

   Channel: function Channel(skyBox, properties) {

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

   },

   State: State

};
