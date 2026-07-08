/* =====================================================================
   TerraForge — EventBus ユニットテスト (Phase03)
   ---------------------------------------------------------------------
   4ケース: on / off / emit / unsubscribe(解除関数)
   ===================================================================== */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventBus, bus } from '../src/core/EventBus.js';
import { Events } from '../src/core/events.js';

describe('EventBus', () => {
  let eb;
  beforeEach(() => {
    eb = new EventBus();
  });

  /* ケース1: on + emit でハンドラが呼ばれる */
  it('on() + emit() でハンドラが呼ばれる', () => {
    const calls = [];
    eb.on('test:event', (p) => calls.push(p));
    eb.emit('test:event', { v: 1 });
    eb.emit('test:event', { v: 2 });
    expect(calls).toEqual([{ v: 1 }, { v: 2 }]);
  });

  /* ケース2: off() で解除したハンドラは emit でも呼ばれない */
  it('off() で解除したハンドラは呼ばれない', () => {
    const calls = [];
    const fn = (p) => calls.push(p);
    eb.on('test:event', fn);
    eb.off('test:event', fn);
    eb.emit('test:event', { v: 1 });
    expect(calls).toEqual([]);
  });

  /* ケース3: 複数ハンドラがあっても対象だけ off される */
  it('off() は対象ハンドラのみ解除する', () => {
    const calls1 = [];
    const calls2 = [];
    const fn1 = (p) => calls1.push(p);
    const fn2 = (p) => calls2.push(p);
    eb.on('test:event', fn1);
    eb.on('test:event', fn2);
    eb.off('test:event', fn1);
    eb.emit('test:event', { v: 9 });
    expect(calls1).toEqual([]);
    expect(calls2).toEqual([{ v: 9 }]);
  });

  /* ケース4: on() の戻り値(解除関数)でリークしない */
  it('on() の戻り値(解除関数)で購読を解除できる', () => {
    const calls = [];
    const unsubscribe = eb.on(Events.MONEY_EARNED, (p) => calls.push(p));
    expect(typeof unsubscribe).toBe('function');

    // 解除前は発火する
    eb.emit(Events.MONEY_EARNED, { amount: 100, total: 600 });
    expect(calls).toHaveLength(1);

    // 解除後は発火しない(リークしない)
    unsubscribe();
    eb.emit(Events.MONEY_EARNED, { amount: 200, total: 800 });
    expect(calls).toHaveLength(1);
  });

  /* 補助: ハンドラ内の例外が他ハンドラや呼び出し元に伝播しない */
  it('ハンドラ内の例外は他ハンドラを止めない', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const order = [];
    eb.on('safe', () => { order.push('first'); throw new Error('boom'); });
    eb.on('safe', () => { order.push('second'); });
    eb.emit('safe', null);
    expect(order).toEqual(['first', 'second']);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  /* 補助: グローバル bus シングルトンが使える */
  it('グローバル bus シングルトンで on/emit できる', () => {
    const calls = [];
    const unsub = bus.on('singleton:test', (p) => calls.push(p));
    bus.emit('singleton:test', { hi: 1 });
    unsub();
    expect(calls).toEqual([{ hi: 1 }]);
  });
});
