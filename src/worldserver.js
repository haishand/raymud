'use strict';

var path = require('path'),
    redis = require('redis');

var Class = require('mixin-pro').createClass;

import { ROOM } from './models/room.js';

export const WorldServer = Class({
  constructor: function WorldServer(conf) {
    this.conf = conf;
    this.reset();
  },

  reset: function() {
    this.db = null;
    this.pub = null;
    this.sub = null;
    this.id = 0;
    this.timer = 0;
    this.isRunning = false;

    this.protos = {};
    this.objects = {};
    this.rooms = {};
    this.chars = {};

    this.counts = {
      protos: 0,
      objects: 0,
      rooms: 0,
      chars: 0,
    };
  },

  startup: function() {
    if(this.isRunning) throw new Error('server is already running.');

    const redis_conf = this.conf.redis;

    // use redis as data storage
    this.db = redis.createClient(redis_conf.port, redis_conf.host, {});
    this.db.on('error', function(err) {
      console.log('db redis eror: ' + err);
    });

    // use redis pub/sub feature as message hub
    this.pub = redis.createClient(redis_conf.port, redis_conf.host, {});
    this.pub.on('error', function(err) {
      console.log('pub redis eror: ' + err);
    });
    this.sub = redis.createClient(redis_conf.port, redis_conf.host, {});
    this.sub.on('error', function(err) {
      console.log('pub redis eror: ' + err);
    });

    const self = this;
    this.db.incr('world:seq', function(err, instanceId){
      if(err) return;
      self.startInstance(instanceId);
    });
  },

  startInstance: function() {
    this.id = instanceId;

    const self = this;
    const conf = this.conf;
    const db = this.db;
    const now = Date.now();

    this.setup();

    // init userver instance info & expire in 5 seconds,
    // we have to update it every 5 seconds, as heartbeat info
    const key = 'world:#' + instanceId;
    db.multi().mset(key, {
      id: instanceId,
      started: now,
      users: 0,
    }).expire(key, 5).zadd('world:all', now, instanceId).exec();

    // init tick() timer
    self.timer = setInterval(function(){
      self.tick();
    }, 1000);

    // init listener for message hub
    const sub = this.sub;
    sub.on('subscribe', function(channel, count){});
    sub.on('message', function(channel, message){
      var words = channel.split('#');
      switch(words[0]) {
        case 'world':
          self.onMessage(message);
          break;
        case 'char':
          const uid = words[1];
          if(uid) {
            const char = self.chars[uid];
            if(char) char.onMessage(message);
          }
          break;
      }
    });
    sub.subscribe('world:#' + instanceId);

    _instances[instanceId] = this;
    this.isRunning = true;
    this.pub.publish('world:log', 'world #' + instanceId + ' started');
  },

  setup: function() {
    const files = this.conf.world;
    if(!Array.isArray(files)) throw new Error('setup: world files not configured');
    for(let i=0; i<files.length; i++) {
      require(files[i]).setup(this);
    }
  },

  loadProto: function(protoKey, proto) {
    if(typeof proto !== 'function') throw new Error('addProto: proto should be function/class');
    proto._key = protoKey;
    this.protos[protoKey] = proto;
    this.counts.protos ++;
  },

  loadRoom: function(roomKey, roomProto) {
    let obj = null;
    switch(typeof roomProto) {
      case 'function':
        obj = new roomProto(this);
        if(!room.instantOf(ROOM)) throw new Error('invalid room proto: ' + roomProto);
        break;
      case 'object':
        obj = new ROOM(this);
        obj.setData(roomProto);
        break;
      case 'string':
        obj = new ROOM(this);
        obj.set('name', roomProto);
        obj.set('short', roomProto);
        break;
      default:
        throw new Error('invalid room proto: ' + roomProto);
        break;
    }

    obj._key = roomKey;
    this.rooms[roomKey] = obj;
    this.counts.rooms ++;

    this.objects[roomKey] = obj;
    this.counts.objects ++;
  },

  loadObject: function(protoKey) {
    let obj = this.objects[protoKey];
    if(!obj) {
      const proto = this.protos[protoKey];
      if(!proto) throw new Error('proto not found: ' + protoKey);
      if(!proto._copyId) proto._copyId = 0;
      if(!proto._copyCnt) proto._copyCnt = 0;

      obj = new proto(this);
      const key = obj._key = protoKey;
      this.objects[key] = obj;
      this.counts.objects ++;
      obj.onCreate();
    }
    return obj;
  },

  cloneObject: function(protoKey) {
    const proto = this.protos[protoKey];
    if(!proto) throw new Error('proto not found: ' + protoKey);
    if(!proto._copyId) proto._copyId = 0;
    if(!proto._copyCnt) proto._copyCnt = 0;

    const obj = new proto(this);
    proto._copyId ++;
    proto._copyCnt ++;
    const key = obj._key = protoKey + '#' + proto._copyId;
    this.objects[key] = obj;
    this.counts.objects ++;
    obj.onCreate();

    return obj;
  },

  destroyObject: function(obj) {
    obj.onDestroy();

    const key = obj._key;
    if(key) {
      delete this.objects[key];
      this.counts.objects --;

      const protoKey = key.split('#')[0];
      if(protoKey) {
        const proto = this.protos[protoKey];
        if(proto) {
          proto._copyCnt --;
        }
      }
    }
  },

  unloadAll: function() {
    // unload chars
    const chars = this.chars;
    for(const i in chars) {
      const char = chars[i];
      char.save();
      char.destruct();
      delete chars[i];
    }
    this.chars = {};
    this.counts.chars = 0;

    // unload rooms
    const rooms = this.rooms;
    for(const i in rooms) {
      const room = rooms[i];
      room.destruct();
      delete rooms[i];
    }
    this.rooms = {};
    this.counts.rooms = 0;

    // unload objects
    const objects = this.objects;
    for(const i in objects) {
      const obj = objects[i];
      obj.destruct();
    }
    this.objects = {};
    this.counts.objects = 0;

    // unload protos
    const protos = this.protos;
    for(const i in protos) {
      delete protos[i];
    }
    this.protos = {};
    this.counts.protos = 0;
  },

  shutdown: function() {
    if(!this.isRunning) return;

    // clear tick() timer
    if(this.timer) clearInterval(this.timer);

    // clear server entry in db
    const db = this.db;
    db.multi().del('world:#' + this.id).zrem('world:all', this.id).exec(function(err, ret){
      db.quit();
    });

    // unload all objects, rooms, and protos
    this.unloadAll();

    this.pub.publish('world:log', 'world #' + this.id + ' closed');

    this.sub.unsubscribe();
    this.sub.end();
    this.pub.end();
    this.db.end();

    delete _instances[this.id];
    this.reset();
  },

  tick: function() {
    const self = this;
    const chars = this.chars;
    const dropped = this.dropped;

    if(this.db && this.id) {
      const key = 'world:#' + this.id;
      this.db.multi()
        .hset(key, 'chars', self.charsCount).expire(key, 5)
        .zremrangebyscore('world:all', 0, Date.now()-5000)
        .zadd('world:all', now, this.id)
        .exec();
    }
  },

  onMessage: function(msg) {
    console.log('world onMessage: ' + msg);
    let req = null;
    try {
      req = JSON.parse(msg);
    } catch(e) {
      console.log(msg);
      return;
    }
    if(!req || typeof req !== 'object') return;

    switch(req.f) {
      case 'enter':
      case 'exit':
      case 'drop':
      case 'reconnect':
      case 'reload':
      case 'call':
        const pub = this.pub;
        const userkey = 'user:#' + req.uid;
        const reply = function(err, ret) {
          pub.publish(userkey, JSON.stringify({
            f: 'reply',
            seq: req.seq,
            err: err,
            ret: ret,
          }));
        };
        const funcName = 'onChar_' + req.f;
        const func = this[funcName];
        if(typeof func === 'function') func(req, reply);
        break;
      default:
        console.log('unknown message: ' + req.f);
    }
  },

  onChar_enter: function(req, reply) {
  },

  onChar_exit: function(req, reply) {
  },

  onChar_drop: function(req, reply) {
  },

  onChar_reconnect: function(req, reply) {
  },

  onChar_reload: function(req, reply) {
  },

  onChar_call: function(req, reply) {
  },

});