const fs = require('node:fs');
const path = require('node:path');

const OUTPUT_PATH = path.resolve(__dirname, '../../config/cctv-codes.json');

function buildDataset() {
  return {
    generatedAt: new Date().toISOString(),
    sources: {
      mode: 'manual_override',
      notes: '按用户提供的 CCTV 清单重写',
    },
    entries: [
      {
        slug: 'airfield',
        nameEn: 'Airfield',
        nameZh: '机场',
        aliases: ['机场', 'airfield', '机场监控'],
        codes: [
          { id: 'AIRFIELDHELIPAD', location: '机场废弃直升机停机坪' },
        ],
      },
      {
        slug: 'bandit-camp',
        nameEn: 'Bandit Camp',
        nameZh: '强盗营地',
        aliases: ['强盗营地', '强盗', 'bandit camp', 'bandit', 'banditcamp'],
        codes: [
          { id: 'CASINO', location: '强盗营地赌场' },
          { id: 'TOWNWEAPONS', location: '强盗营地武器商人' },
        ],
      },
      {
        slug: 'outpost',
        nameEn: 'Outpost',
        nameZh: '前哨站',
        aliases: ['前哨站', '前哨', 'outpost', 'compound'],
        codes: [
          { id: 'COMPOUNDCHILL', location: '前哨站餐区' },
          { id: 'COMPOUNDMUSIC', location: '前哨站音乐台' },
          { id: 'COMPOUNDCRUDE', location: '前哨站炼油机' },
          { id: 'COMPOUNDSTREET', location: '前哨站大街' },
        ],
      },
      {
        slug: 'the-dome',
        nameEn: 'The Dome',
        nameZh: '大铁球',
        aliases: ['大铁球', '圆顶', '大圆顶', 'dome', 'the dome'],
        codes: [
          { id: 'DOME1', location: '大铁球' },
          { id: 'DOMETOP', location: '大铁球顶部' },
        ],
      },
      {
        slug: 'radtown',
        nameEn: 'Radtown',
        nameZh: '辐射镇',
        aliases: ['辐射镇', '辐射', 'radtown'],
        codes: [
          { id: 'RADTOWNAPARTMENTS', location: '辐射镇公寓' },
          { id: 'RADTOWNHOUSE', location: '辐射镇房屋' },
          { id: 'RADTOWNSBL', location: '辐射镇SBL' },
        ],
      },
      {
        slug: 'cargo-ship',
        nameEn: 'Cargo Ship',
        nameZh: '货轮',
        aliases: ['货轮', '货船', 'cargo', 'cargo ship'],
        codes: [
          { id: 'CARGODECK', location: '前甲板' },
          { id: 'CARGOBRIDGE', location: '通道' },
          { id: 'CARGOSTERN', location: '后甲板' },
          { id: 'CARGOHOLD1', location: '舱内1' },
          { id: 'CARGOHOLD2', location: '舱内2' },
        ],
      },
      {
        slug: 'oil-rig-small',
        nameEn: 'Small Oil Rig',
        nameZh: '小型石油钻井平台',
        aliases: ['小型石油钻井平台', '小石油', '小油井', 'small oil rig', 'oil rig 1'],
        codes: [
          { id: 'OILRIG1HELI', location: '小油井停机坪' },
          { id: 'OILRIG1DOCK', location: '小油井港口' },
          { id: 'OILRIG1L1', location: '小油井一楼' },
          { id: 'OILRIG1L2', location: '小油井二楼' },
          { id: 'OILRIG1L3', location: '小油井三楼' },
          { id: 'OILRIG1L4', location: '小油井四楼' },
        ],
      },
      {
        slug: 'oil-rig-large',
        nameEn: 'Large Oil Rig',
        nameZh: '大型石油钻井平台',
        aliases: ['大型石油钻井平台', '大石油', '大油井', 'large oil rig', 'oil rig 2'],
        codes: [
          { id: 'OILRIG2HELI', location: '大油井停机坪' },
          { id: 'OILRIG2DOCK', location: '大油井港口' },
          { id: 'OILRIG2L1', location: '大油井一楼' },
          { id: 'OILRIG3L2', location: '大油井二楼' },
          { id: 'OILRIG2L3A', location: '大油井三楼A' },
          { id: 'OILRIG2L3B', location: '大油井三楼B' },
          { id: 'OILRIG2L4', location: '大油井四楼' },
          { id: 'OILRIG2L5', location: '大油井五楼' },
          { id: 'OILRIG2L6A', location: '大油井六楼A' },
          { id: 'OILRIG2L6B', location: '大油井六楼B' },
          { id: 'OILRIG2L6C', location: '大油井六楼C' },
          { id: 'OILRIG2L6D', location: '大油井六楼D' },
          { id: 'OILRIG2EXHAUST', location: '大油井排气孔' },
        ],
      },
      {
        slug: 'missile-silo',
        nameEn: 'Missile Silo',
        nameZh: '导弹发射井',
        aliases: ['导弹发射井', '导弹井', '导弹基地', 'missile silo', 'silo'],
        codes: [
          { id: 'SILOEXIT1', location: '导弹发射井井上' },
          { id: 'SILOEXIT2', location: '导弹发射井井上' },
          { id: 'SILOTOWER', location: '导弹发射井井上' },
          { id: 'SILOSHIPPING', location: '导弹发射井井内' },
          { id: 'SILOMISSILE', location: '导弹发射井井内' },
        ],
      },
      {
        slug: 'ferry-terminal',
        nameEn: 'Ferry Terminal',
        nameZh: '渡轮码头',
        aliases: ['渡轮码头', '轮渡码头', 'ferry terminal', 'ferry'],
        codes: [
          { id: 'FERRYDOCK', location: '渡轮码头码头区' },
          { id: 'FERRYUTILITIES', location: '渡轮码头设施区' },
          { id: 'FERRYPARKING', location: '渡轮码头停车区' },
          { id: 'FERRYLOGISTICS', location: '渡轮码头物流区' },
        ],
      },
    ],
  };
}

function main() {
  const payload = buildDataset();
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`updated ${OUTPUT_PATH} (${payload.entries.length} entries)`);
}

if (require.main === module) {
  main();
}

module.exports = {
  buildDataset,
};
