/* =====================================================================
   TerraForge — アイテム InstancedMesh レンダラー (Phase05)
   ---------------------------------------------------------------------
   物流アイテム(鉱石/インゴット)の描画を個別 Mesh から2つの
   InstancedMesh に集約し、ドローコールを ore 用+ingot 用の計2に固定する。

   sync(items) を毎フレーム呼ぶだけで、全アイテムの位置・回転・色を
   InstancedMesh に同期する。

   Phase17 で加工品ジオメトリ(第3の InstancedMesh)を追加する前提で、
   内部のメッシュ配列で拡張可能な設計にしている。
   ===================================================================== */
import { ORES } from '../constants.js';
import { itemGeoOre, itemGeoIngot } from './meshes.js';

/** アイテム用の共通マテリアル(1つで ore/ingot 共有。色は instanceColor で制御) */
const sharedItemMat = new THREE.MeshStandardMaterial({
  metalness: 0.7,
  roughness: 0.3,
});

const _mat4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _yAxis = new THREE.Vector3(0, 1, 0);
const _scl = new THREE.Vector3(1, 1, 1);
const _color = new THREE.Color();

export class ItemRenderer {
  /**
   * @param {THREE.Scene} scene
   * @param {number} maxItems - InstancedMesh の最大インスタンス数
   */
  constructor(scene, maxItems = 1024) {
    /** @type {Array<{mesh: THREE.InstancedMesh, isIngot: boolean, count: number}>} */
    this.layers = [];

    // ore 用 (IcosahedronGeometry)
    const oreMesh = new THREE.InstancedMesh(itemGeoOre, sharedItemMat, maxItems);
    oreMesh.count = 0;
    oreMesh.frustumCulled = false;
    oreMesh.castShadow = true;
    oreMesh.receiveShadow = false;
    scene.add(oreMesh);
    this.layers.push({ mesh: oreMesh, isIngot: false, count: 0 });

    // ingot 用 (BoxGeometry)
    const ingotMesh = new THREE.InstancedMesh(itemGeoIngot, sharedItemMat, maxItems);
    ingotMesh.count = 0;
    ingotMesh.frustumCulled = false;
    ingotMesh.castShadow = true;
    ingotMesh.receiveShadow = false;
    scene.add(ingotMesh);
    this.layers.push({ mesh: ingotMesh, isIngot: true, count: 0 });

    /** 最大インスタンス数(全レイヤ共通) */
    this.maxItems = maxItems;
  }

  /**
   * 毎フレーム呼び出し: items配列を走査し、ore/ingotごとに
   * 位置・回転・色を InstancedMesh に書き込む。
   * @param {Iterable} items - ItemPool.slots のような iterable
   */
  sync(items) {
    // 各レイヤのカウンタをリセット
    for (let i = 0; i < this.layers.length; i++) {
      this.layers[i].count = 0;
    }

    for (const it of items) {
      if (!it.active) continue;

      // レイヤ選択 (ore or ingot)
      let layer;
      if (it.ingot) {
        layer = this.layers[1]; // ingot
      } else {
        layer = this.layers[0]; // ore
      }

      const idx = layer.count;
      if (idx >= this.maxItems) continue; // 容量オーバーはスキップ
      layer.count++;

      // ワールド座標 + Y回転を行列に書き込み
      _pos.set(it.pos.x, it.pos.y, it.pos.z);
      _quat.setFromAxisAngle(_yAxis, it.rotY || 0);
      _mat4.compose(_pos, _quat, _scl);
      layer.mesh.setMatrixAt(idx, _mat4);

      // アイテム色を instanceColor に設定
      const spec = ORES[it.oreType];
      if (spec) {
        _color.set(it.ingot ? spec.ingotColor : spec.color);
      } else {
        _color.setHex(0xffffff);
      }
      layer.mesh.setColorAt(idx, _color);
    }

    // InstancedMesh の count とフラグを更新
    for (let i = 0; i < this.layers.length; i++) {
      const l = this.layers[i];
      l.mesh.count = l.count;
      l.mesh.instanceMatrix.needsUpdate = true;
      if (l.mesh.instanceColor) l.mesh.instanceColor.needsUpdate = true;
    }
  }

  /**
   * レンダリング情報(デバッグ用)。
   * @returns {{oreCount: number, ingotCount: number, total: number}}
   */
  info() {
    return {
      oreCount: this.layers[0].count,
      ingotCount: this.layers[1].count,
      total: this.layers[0].count + this.layers[1].count,
    };
  }
}
