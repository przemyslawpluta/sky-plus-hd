#!/usr/bin/env node

var app = require('express')()
   ,server = require('http').createServer(app)
   ,io = require('socket.io').listen(server,{'log level':0})
   ,express = require('express')
   ,Sky = require('../..');

app.use(express.static('static'));
app.get('/',function(req,res) { res.sendfile('static/index.html'); });

io.sockets.on('connection',function(socket) {
   if (last.change) socket.emit('change',last.change);
   if (last.state) socket.emit('changeState',last.state);
   socket.on('changeChannel',function(channel) {
      sky.changeChannel(channel);
   });
   socket.on('pause',function() {
      sky.pause();
   });
   socket.on('play',function(speed) {
      sky.play(speed);
   });
});

/* ==== */

var sky = new Sky();

var last = {
   change: null,
   state: null
}
sky.on('change',function(data) {
   var saveData = last.change = {
      ts: new Date().valueOf(),
      data: data
   };
   io.sockets.emit('change',saveData);
});
sky.on('changeState',function(data) {
   var saveData = last.state = {
      ts: new Date().valueOf(),
      data: data
   };
   io.sockets.emit('changeState',saveData);
});

sky.on('ready',function() {
   sky.monitor();
   server.listen(55580);
});

process.on('exit',function() {
  sky.close();
}).on('SIGINT',function() {
  process.exit();
});
