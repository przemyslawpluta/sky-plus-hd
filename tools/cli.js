var celeri = require('celeri'),
   SkyPlusHD = require('../'),
   skyFinder = new SkyPlusHD().find();

skyFinder.then(function find(skyBox) {

   'use strict';

   console.log('Initialized: ' + skyBox.description);

   skyBox.on('ready', function ready() {
      console.log('Ready ...');
      celeri.open({ prefix: 'sky-plus-hd > '});
   });

   celeri.option({
      command: 'channel :number',
      description: 'Changes to the specified channel number',
   }, function resolve(data) {
      var spinner = celeri.loading('Changing to channel ' + data.number);

      skyBox.setChannel({number:parseInt(data.number, 10)}).then(function resolve() {
         spinner.done();
      }).fail(function fail() {
         spinner.done(true);
      });

   });

   celeri.option({
      command: 'pause',
      description: 'Pauses the currently playing programme',
   }, function resolve() {
      var spinner = celeri.loading('Pausing');

      skyBox.pause().then(function pause() {
         spinner.done();
      }).fail(function fail() {
         spinner.done(true);
      });

   });

   celeri.option({
      command: 'play',
      description: 'Play the currently playing programme',
   }, function resolve() {
      var spinner = celeri.loading('Playing');

      skyBox.play().then(function play() {
         spinner.done();
      }).fail(function fail() {
         spinner.done(true);
      });

   });

   celeri.option({
      command: 'fwd',
      description: 'Fwd the currently playing programme',
   }, function resolve() {
      var spinner = celeri.loading('Playing');

      skyBox.fwd().then(function fwd() {
         spinner.done();
      }).fail(function fail() {
         spinner.done(true);
      });

   });

   celeri.option({
      command: 'rew',
      description: 'Rew the currently playing programme',
   }, function resolve() {
      var spinner = celeri.loading('Playing');

      skyBox.rew().then(function rew() {
         spinner.done();
      }).fail(function fail() {
         spinner.done(true);
      });

   });

   celeri.option({
      command: 'up',
      description: 'Channel up from currently playing programme',
   }, function resolve() {
      var spinner = celeri.loading('Playing');

      skyBox.channelUp().then(function channelUp() {
         spinner.done();
      }).fail(function fail() {
         spinner.done(true);
      });

   });

   celeri.option({
      command: 'down',
      description: 'Channel down from currently playing programme',
   }, function resolve() {
      var spinner = celeri.loading('Playing');

      skyBox.channelDown().then(function channelDown() {
         spinner.done();
      }).fail(function fail() {
         spinner.done(true);
      });

   });

   celeri.option({
      command: 'channelinfo :channel',
      description: 'Show info for the specified channel'
   },function resolve(data) {
      var spinner = celeri.loading('Getting channel info for ' + data.channel);

      skyBox.findChannel({number: +data.channel}).then(function resolve(channel) {
         spinner.done();
         var table = [channel];
         table.push({number:'======', name:'====', id:'==', idHex:'======'},{number:'NUMBER', name:'NAME', id:'ID', idHex:'ID HEX'});
         celeri.drawTable(table,{ columns: ['number', 'name', 'id', 'idHex'] });
      }).fail(function fail(){
         spinner.done(true);
      });

   });

   celeri.option({
      command: 'channels',
      description: 'Show info for all channels'
   },function resolve() {
      var spinner = celeri.loading('Getting channels list');
      skyBox.getChannelList().then(function resolve(channelList) {
         channelList.reverse();

         spinner.done();
         celeri.drawTable(channelList,{ columns: ['number','name','id','idHex'] });
      }).fail(function fail() {
         spinner.done(true);
      });
   });

   celeri.option({
      command: 'planner',
      description: 'Show info for planner items'
   },function resolve() {
      var spinner = celeri.loading('Getting planner list');
      skyBox.planner.getPlannerItems().then(function resolve(items) {
         items.reverse();
         spinner.done();
         celeri.drawTable(items, { columns: ['title', 'isViewed', 'description'] });
      }).fail(function fail() {
         spinner.done(true);
      });
   });

   celeri.parse(process.argv);

});

skyFinder.fail(function fail(err) {

   'use strict';

   console.log('Failed to find skybox, ' + err);

});