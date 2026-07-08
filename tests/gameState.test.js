/* =====================================================================
   TerraForge — GameState ユニットテスト (Phase03)
   ---------------------------------------------------------------------
   3ケース(指定): earn がマイルストーンを跨ぐと milestone:reached が発火する等
   ===================================================================== */
import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest';
import { GameState, gameState } from '../src/core/GameState.js';
import { bus } from '../src/core/EventBus.js';
import { Events } from '../src/core/events.js';
import { MILESTONES, START_MONEY } from '../src/constants.js';

/* THREE は GameState 単体テストでは不要だが、他モジュール経由で読み込まれる
   可能性があるためモックしておく */
beforeAll(() => {
  global.THREE = global.THREE || {
    Object3D: class { constructor() { this.position = { x:0, y:0, z:0 }; this.children = []; } clone() { return new THREE.Object3D(); } },
    Vector3: class { constructor(x,y,z) { this.x=x; this.y=y; this.z=z; } clone() { return new THREE.Vector3(this.x,this.y,this.z); } addScaledVector() {} },
  };
});

describe('GameState', () => {
  let gs;
  beforeEach(() => {
    gs = new GameState();
    bus.clear();
  });

  /* ケース1: earn が money:earned を発火し、stats.earned も更新する */
  it('earn() は money:earned を発火し stats.earned を加算する', () => {
    const earnedCalls = [];
    bus.on(Events.MONEY_EARNED, (p) => earnedCalls.push(p));

    const before = gs.money;
    gs.earn(250);
    expect(gs.money).toBe(before + 250);
    expect(gs.stats.earned).toBe(250);
    expect(earnedCalls).toHaveLength(1);
    expect(earnedCalls[0]).toMatchObject({ amount: 250, total: before + 250, earned: 250 });
  });

  /* ケース2: earn がマイルストーン閾値を跨ぐと milestone:reached が発火し、
     ボーナス reward が money へ加算される */
  it('earn() がマイルストーンを跨ぐと milestone:reached が発火し reward が加算される', () => {
    const milestoneCalls = [];
    bus.on(Events.MILESTONE_REACHED, (p) => milestoneCalls.push(p));

    // stats.earned を第1マイルストーン直前まで進める
    const firstMs = MILESTONES[0]; // { at: 1000, reward: 150, ... }
    gs.stats.earned = firstMs.at - 100; // あと100で到達
    const moneyBefore = gs.money;

    // 100 → stats.earned = firstMs.at で到達。reward も加算される
    gs.earn(100);

    expect(milestoneCalls).toHaveLength(1);
    expect(milestoneCalls[0].milestone).toBe(firstMs);
    expect(milestoneCalls[0].reward).toBe(firstMs.reward);
    expect(milestoneCalls[0].index).toBe(0);
    // money = moneyBefore + 100(売上) + reward(ボーナス)
    expect(gs.money).toBe(moneyBefore + 100 + firstMs.reward);
    expect(gs.stats.msIndex).toBe(1);
  });

  /* ケース3: 複数マイルストーンを一度に跨ぐ場合、全て発火する */
  it('earn() が複数マイルストーンを同時跨ぐ場合、全て milestone:reached が発火する', () => {
    const milestoneCalls = [];
    bus.on(Events.MILESTONE_REACHED, (p) => milestoneCalls.push(p));

    // 一気に3つ目のマイルストーンまで到達させる
    const moneyBefore = gs.money;
    gs.earn(MILESTONES[2].at); // 第3マイルストーン閾値まで一気に稼ぐ

    // 第1, 第2, 第3 の3つが発火するはず
    expect(milestoneCalls).toHaveLength(3);
    expect(milestoneCalls[0].milestone).toBe(MILESTONES[0]);
    expect(milestoneCalls[1].milestone).toBe(MILESTONES[1]);
    expect(milestoneCalls[2].milestone).toBe(MILESTONES[2]);
    expect(gs.stats.msIndex).toBe(3);
    // ボーナス合計 = MILESTONES[0..2].reward の和
    const totalReward = MILESTONES[0].reward + MILESTONES[1].reward + MILESTONES[2].reward;
    expect(gs.money).toBe(moneyBefore + MILESTONES[2].at + totalReward);
  });

  /* 補助1: money への直接代入は getter を通さないので変更されない */
  it('money は getter のみで、直接代入しても内部値は変わらない', () => {
    const before = gs.money;
    // strict mode では代入は無視されるかエラーになるが、JS では単に無視される
    try { gs.money = 99999; } catch (e) { /* setter がない場合はスルー */ }
    expect(gs.money).toBe(before);
  });

  /* 補助2: addMoney は money:changed を発火するが money:earned は発火しない */
  it('addMoney() は money:changed のみ発火し money:earned は発火しない', () => {
    const changedCalls = [];
    const earnedCalls = [];
    bus.on(Events.MONEY_CHANGED, (p) => changedCalls.push(p));
    bus.on(Events.MONEY_EARNED, (p) => earnedCalls.push(p));

    gs.addMoney(-50);
    expect(changedCalls.length).toBeGreaterThanOrEqual(1);
    expect(earnedCalls).toEqual([]);
  });

  /* 補助3: serialize/deserialize で基本フィールドがラウンドトリップする */
  it('serialize()/deserialize() で基本フィールドがラウンドトリップする', () => {
    gs.earn(500);
    gs.tool = 'conveyor';
    gs.buildDir = 2;
    gs.selectedFilter = 'gold';
    gs.time = 12.5;
    gs.seed = 12345;

    const data = gs.serialize();
    const gs2 = new GameState();
    gs2.deserialize(data);

    expect(gs2.money).toBe(gs.money);
    expect(gs2.stats.earned).toBe(500);
    expect(gs2.tool).toBe('conveyor');
    expect(gs2.buildDir).toBe(2);
    expect(gs2.selectedFilter).toBe('gold');
    expect(gs2.time).toBe(12.5);
    expect(gs2.seed).toBe(12345);
  });

  /* 補助5b(Phase06): muted/playTime も serialize()/deserialize() でラウンドトリップする */
  it('Phase06: muted/playTime も serialize()/deserialize() でラウンドトリップする', () => {
    gs.muted = true;
    gs.playTime = 3600;

    const data = gs.serialize();
    const gs2 = new GameState();
    gs2.deserialize(data);

    expect(gs2.muted).toBe(true);
    expect(gs2.playTime).toBe(3600);
  });

  /* 補助6: グローバル gameState シングルトンが START_MONEY で初期化されている */
  it('グローバル gameState は START_MONEY で初期化されている', () => {
    expect(gameState.money).toBe(START_MONEY);
    expect(gameState.stats.earned).toBe(0);
    expect(gameState.stats.msIndex).toBe(0);
  });

  /* 補助5: power 状態は PowerGrid が管理するため、GameState には setPower が存在しない */
  it('GameState には setPower / markPowerDirty が存在しない(Phase04 で PowerGrid に移行)', () => {
    expect(typeof gs.setPower).toBe('undefined');
    expect(typeof gs.markPowerDirty).toBe('undefined');
  });
});
