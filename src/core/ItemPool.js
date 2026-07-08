/* =====================================================================
   TerraForge — アイテムオブジェクトプール (Phase05)
   ---------------------------------------------------------------------
   個別 THREE.Mesh を毎回 new/delete するのをやめ、プール化した
   純データオブジェクト(acquire/release)でメモリフラグメンテーションと
   GCプレッシャーを抑制する。

   acquire() は非activeスロットを返し、なければ新規push。
   release(it) は active=false にするだけで splice しない。
   走査時は active フィルタで有効アイテムのみ処理する。
   ===================================================================== */

export class ItemPool {
  constructor() {
    /** @type {Array<{oreType, ingot, pos, rotY, gx, gz, moving, t, from, to, moveSpeed, destKey, active, incoming}>} */
    this.slots = [];
  }

  /**
   * アイテムスロットを取得する。
   * 非activeスロットがあれば再利用、なければ新規作成。
   * @param {string} oreType
   * @param {boolean} ingot
   * @param {number} gx
   * @param {number} gz
   * @param {THREE.Vector3} pos - 初期ワールド座標
   * @returns {{oreType, ingot, pos, rotY, gx, gz, moving, t, from, to, moveSpeed, destKey, active}}
   */
  acquire(oreType, ingot, gx, gz, pos) {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (!s.active) {
        s.oreType = oreType;
        s.ingot = ingot;
        s.gx = gx;
        s.gz = gz;
        s.pos.copy(pos);
        s.rotY = 0;
        s.moving = false;
        s.t = 0;
        s.from = null;
        s.to = null;
        s.moveSpeed = 0;
        s.destKey = null;
        s.active = true;
        return s;
      }
    }
    // 新規スロット
    const slot = {
      oreType, ingot, gx, gz,
      pos: pos.clone(),
      rotY: 0,
      moving: false, t: 0,
      from: null, to: null,
      moveSpeed: 0,
      destKey: null,
      active: true,
    };
    this.slots.push(slot);
    return slot;
  }

  /**
   * スロットを解放する(非activeにする)。spliceしない。
   * @param {object} it
   */
  release(it) {
    it.active = false;
  }

  /**
   * 有効(active)アイテムの数。
   * @returns {number}
   */
  get activeCount() {
    let n = 0;
    for (let i = 0; i < this.slots.length; i++) {
      if (this.slots[i].active) n++;
    }
    return n;
  }

  /**
   * 全スロット数(プールサイズ)。
   * @returns {number}
   */
  get size() {
    return this.slots.length;
  }
}
