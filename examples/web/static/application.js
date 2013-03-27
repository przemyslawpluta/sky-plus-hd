var socket = io.connect(document.location.href);

/* ===== */

var CurrentSkyChannel = Backbone.Model.extend({
   defaults: {
      channel: null,
      isHD: null,
      name: null
   },
   initialize: function() {
      var that = this;
      socket.on('change',function(change) {
         that.set(_.extend({},that.defaults,change.data.channel));
      });
   }
});

var CurrentSkyChannel_View = Backbone.View.extend({
   className: 'CurrentSkyChannel',
   initialize: function() {
      this.template = _.template($('script#template_'+this.className).text());
      var that = this;
      this.model.on('change',function() {
         that.render();
      });
      //
      this.controllerView = new SkyController_View({
         model: new SkyController()
      });
   },
   render: function() {
      if (!this.model.get('channel')) return this;
      this.$el.html(this.template(this.model.attributes));
      this.$el.find('.controller').append(this.controllerView.render().el);
      return this;
   }
});

/* ===== */

var CurrentSkyProgram = Backbone.Model.extend({
   defaults: {
      description: null,
      details: null,
      duration: null,
      end: null,
      eventId: null,
      image: null,
      start: null,
      title: null,
      url: null
   },
   initialize: function() {
      var that = this;
      socket.on('change',function(change) {
         that.set(_.extend({},that.defaults,change.data.program.now));
      });
   }
});

var CurrentSkyProgram_View = Backbone.View.extend({
   className: 'CurrentSkyProgram',
   initialize: function() {
      this.template = _.template($('script#template_'+this.className).text());
      var that = this;
      this.model.on('change',function() {
         that.render();
      });
   },
   render: function() {
      if (!this.model.get('title')) return this;
      this.$el.html(this.template(this.model.attributes));
      return this;
   }
});

/* ===== */

var SkyController = Backbone.Model.extend({
   defaults: {
      state: 'pause',
      speed: 0
   },
   initialize: function() {
      var that = this;
      socket.on('changeState',function(state) {
         that.set(_.extend({},that.defaults,state.data));
      });
   }
});

/* ===== */

var SkyController_View = Backbone.View.extend({
   className: 'SkyController',
   initialize: function() {
      this.template = _.template($('script#template_'+this.className).text());
      var that = this;
      this.model.on('change',function() {
         that.render();
      });
   },
   render: function() {
      this.$el.html(this.template(this.model.attributes));
      return this;
   }
});

/* ===== */

$(function() {

   var channelView = window.channelView = new CurrentSkyChannel_View({
      model: new CurrentSkyChannel()
   });

   var programView = window.programView = new CurrentSkyProgram_View({
      model: new CurrentSkyProgram()
   });

   $('body').append([channelView.render().el, programView.render().el]);

});