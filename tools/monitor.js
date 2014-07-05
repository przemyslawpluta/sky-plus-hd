var util = require('util'),
   SkyPlusHD = require('../'),
   skyFinder = new SkyPlusHD().find();

skyFinder.then(function find(skyBox) {

   'use strict';

   console.log('Initialized: ' + skyBox.description);

   console.log('Reading planner...');

   skyBox.planner.getPlannerItems().then(function getPlannerItems(items) {
      console.log('Planner contains ' + items.length + ' items');
   });

   skyBox.on('stateChanged', function stateChanged(playEvent) {
      console.log(util.format('>>> State:[%s] URI:[%s] Speed:[%s]', playEvent.TransportState, playEvent.CurrentTrackURI, playEvent.TransportPlaySpeed));
   });

   skyBox.on('ready', function ready(channel) {

      console.log('Ready ...');
      console.dir(channel);

   });

});

skyFinder.fail(function fail(err) {

   'use strict';

   console.log('Failed to find skybox, ' + err);

});