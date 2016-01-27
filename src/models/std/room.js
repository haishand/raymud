'use strict';

import { F_DBASE, F_CLEAN_UP } from '../feature/base.js';

export const ROOM = Class([F_DBASE, F_CLEAN_UP], {
  constructor: function ROOM() {
    this._doors = {};
    this._guards = {};
  },
  
  receiveObject: function(ob, fromInventory) {
    return 1;
  },

  cleanUp(inheritFlag) {
    const items = this.queryTemp('objects');
    if(items) {
      for(let i=items.length-1; i>=0; i--) {
        const ob = items[i];
        if((ob.instanceOf(CHARACTER)) && (ob.environment() === this)) return true;
      }
    }
    
    var func = this.Super('cleanUp');
    if(typeof func === 'function')
      func.call(this, inheritFlag);
  },

  remove(thisPlayer) {
    let cnt = 0;
    const items = this.queryTemp('objects');
    for(let i=items.length-1; i>=0; i--) {
      const ob = items[i];
      if(ob && ob.instanceOf(CHARACTER)) {
        const env = ob.environment();
        if(env !== this) {
          SYSTEM.message('vision', `一阵强烈的闪光忽然出现，吞没了${ob.name()}。\n`, env);
          items.splice(i, 1);
          SYSTEM.destruct(ob);
          cnt++;
        }
      }
    }
    if(cnt && USER.current()) {
      USER.current().write(`WARNNING: ${cnt} wandering NPC(s) created by this room are forced destructed.\n`);
    }
  },

  reset() {
    const obList = this.query('objects');
    if(obList) {
      let ob = this.queryTemp('objects');
      if(!ob) ob = {};
      for(const key in obList) {
        const amount = obList[key];
        // TODO:
        if(amount === 1) {
          break;
        } else {
          break;
        }
      }
      this.setTemp('objects', ob);
    }
  }
});