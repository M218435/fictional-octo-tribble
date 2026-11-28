/* GOLDEN HOUR — 运行时中文汉化层
 * 不修改 game.js，只在 DOM 层做英译中，覆盖静态与动态界面。
 */
(function () {
  'use strict';

  var DICT = {
    /* ===== 主菜单 ===== */
    'SOLSTICE HOTEL · SKY LOBBY · 47F': '暮色酒店 · 天空大堂 · 47 层',
    'SOLSTICE HOTEL': '暮色酒店',
    'TEAM DEATHMATCH — 5 v 5 — FIRST TO 40': '团队死斗 — 5 对 5 — 先到 40 分',
    'TEAM DEATHMATCH — SOLSTICE HOTEL': '团队死斗 — 暮色酒店',
    'TEAM DEATHMATCH · SOLSTICE HOTEL': '团队死斗 · 暮色酒店',
    'TEAM DEATHMATCH': '团队死斗',
    'DEPLOY': '部署',
    'GUNSMITH': '枪匠',
    'ATTACHMENTS · CAMOS': '配件 · 迷彩',
    'DIFFICULTY': '难度',
    'SETTINGS': '设置',
    'CONTROLS · AUDIO · GRAPHICS': '操作 · 音频 · 画面',
    'LOADOUT': '装备配置',
    'FRAG × 2': '破片手雷 ×2',
    'FIELD UPGRADE —': '战地升级 —',
    'FIELD UPGRADE — K9 UNIT': '战地升级 — K9 军犬',
    'K9 UNIT': 'K9 军犬',
    'Charges in 80 s · hunts on its own for 40 s': '每 80 秒充能 · 自主猎杀 40 秒',
    'OPERATOR · VANGUARD': '干员 · 先锋',
    'MATCHES': '对局',
    'WINS': '胜场',
    'WIN RATE': '胜率',
    'ELIMS': '击杀',
    'WEAPON MASTERY': '武器精通',
    'CAMOS': '迷彩',
    'FACTORY CONFIGURATION': '出厂配置',
    'NAVIGATE': '导航',
    'SELECT': '选择',
    'CHANGE': '调整',
    'ADJUST': '调整',
    'BACK': '返回',
    'CHOOSE': '选择',

    /* ===== 军衔 ===== */
    'RECRUIT': '新兵',
    'OPERATOR': '干员',
    'SPECIALIST': '专精',
    'SERGEANT': '中士',
    'LIEUTENANT': '中尉',
    'CAPTAIN': '上尉',
    'MAJOR': '少校',
    'COLONEL': '上校',
    'COMMANDER': '指挥官',
    'VANGUARD': '先锋',
    'LEGEND': '传奇',
    'EMBER': '余烬',

    /* ===== 难度 ===== */
    'REGULAR': '普通',
    'HARDENED': '强化',
    'VETERAN': '老兵',

    /* ===== 暂停菜单 ===== */
    'PAUSED': '已暂停',
    'SCOREBOARD': '记分板',
    'FIRST TO 40': '先到 40 分',
    'RESUME': '继续',
    'APPLIES ON NEXT SPAWN': '下次重生生效',
    'CHANGES APPLY ON YOUR NEXT SPAWN': '改动将在下次重生时生效',
    'SET AS PRIMARY': '设为主武器',
    'UNLEASH THE K9 UNIT — IT HUNTS ON ITS OWN': '放出 K9 军犬 — 它会自主猎杀',
    'QUIT TO MENU': '退出到主菜单',
    'PRESS AGAIN TO FORFEIT': '再按一次确认放弃',

    /* ===== 设置：标签页 ===== */
    'CONTROLS': '操作',
    'MOUSE & VIEW': '鼠标与视角',
    'AUDIO': '音频',
    'GRAPHICS': '画面',
    'INTERFACE': '界面',

    /* ===== 设置：按键分组 ===== */
    'MOVEMENT': '移动',
    'MOVE': '移动',
    'SPRINT — ANY DIRECTION': '冲刺 — 任意方向',
    'JUMP / MANTLE': '跳跃 / 翻越',
    'CROUCH / SLIDE': '蹲下 / 滑铲',
    'PRONE / DIVE': '卧倒 / 扑倒',
    'COMBAT': '战斗',
    'FIRE': '开火',
    'AIM DOWN SIGHTS': '开镜瞄准',
    'RELOAD': '装填',
    'MELEE': '近战',
    'FRAG GRENADE': '破片手雷',
    'UNLEASH K9 UNIT': '放出 K9 军犬',
    'SWAP WEAPON': '切换武器',
    'INSPECT WEAPON': '检视武器',
    'GENERAL': '通用',
    'PAUSE / BACK': '暂停 / 返回',
    'MENU NAVIGATE': '菜单导航',
    'MENU SELECT': '菜单确认',
    'SWITCH TAB': '切换标签',
    'FULLSCREEN': '全屏',
    'OR': '或',

    /* ===== 设置：行 ===== */
    'MOUSE SENSITIVITY': '鼠标灵敏度',
    'ADS SENSITIVITY MULTIPLIER': '开镜灵敏度倍率',
    'INVERT VERTICAL LOOK': '垂直视角反转',
    'FIELD OF VIEW': '视场角',
    'MASTER VOLUME': '主音量',
    'EFFECTS VOLUME': '音效音量',
    'MUSIC VOLUME': '音乐音量',
    'QUALITY PRESET': '特效质量',
    'MOTION BLUR': '动态模糊',
    'MINIMAP': '小地图',
    'CROSSHAIR COLOUR': '准星颜色',
    'HUD SCALE': 'HUD 缩放',
    'CONTROL HINTS': '操作提示',

    /* ===== 设置：选项值 ===== */
    'OFF': '关',
    'ON': '开',
    'LOW': '低',
    'MEDIUM': '中',
    'HIGH': '高',
    'ULTRA': '极高',
    'ROTATING': '旋转',
    'NORTH UP': '北向上',
    'WHITE': '白色',
    'CYAN': '青色',
    'LIME': '绿色',
    'AMBER': '琥珀色',
    'low': '低',
    'medium': '中',
    'high': '高',
    'ultra': '极高',

    /* ===== 设置：说明文字 ===== */
    'How far the view turns for a given mouse movement. Lower is steadier for rifles; higher turns faster in close quarters.':
      '鼠标移动量对应的视角转动幅度。数值越低，步枪越稳；数值越高，近距离转身越快。',
    'Applied on top of sensitivity while aiming down sights. Zoom already slows the view; 1.00 keeps the same hand distance per on-screen distance.':
      '开镜时叠加在基础灵敏度之上的倍率。倍率本身已让视角变慢；1.00 表示屏幕距离与实际手部移动保持一致。',
    'Pushing the mouse forward looks down instead of up.': '向前推鼠标时视角向下而非向上。',
    'Horizontal field of view at 16:9. Wider shows more of the room and makes movement feel faster; narrower makes distant targets larger.':
      '16:9 下的水平视场角。数值越大，看到的房间越多、移动感越快；数值越小，远处目标越大。',
    'Overall loudness of everything: weapons, footsteps, interface and music.':
      '所有声音的总音量：武器、脚步、界面与音乐。',
    'Weapons, impacts, footsteps and ambience, relative to the master volume.':
      '武器、命中、脚步与环境音，相对主音量调节。',
    'Menu score and the lounge band playing in the Ember Bar. Shooting the speaker also works.':
      '菜单配乐与余烬酒吧的现场乐队。打掉音响也能让它安静。',
    'Effects preset for shadow quality and costly lighting, reflection, and post-processing work. Render resolution is adjusted separately.':
      '只调整阴影、光照、反射与后处理特效。渲染分辨率由独立滑杆控制，切换特效档位不会改变分辨率。',
    'Film-style blur on fast camera turns and on the weapon and hands as they move (reload, recoil, swap). The weapon stays sharp at rest. Off is the competitive choice.':
      '快速转视角以及换弹、后坐、切枪时，画面与手臂产生电影感模糊。静止时武器保持清晰。竞技玩家建议关闭。',
    'Borderless fullscreen. F11 does the same; Esc leaves it.': '无边框全屏。F11 效果相同；Esc 退出。',
    'Rotating keeps your view pointing up, like the compass. North Up keeps the hotel still and turns your arrow instead.':
      '旋转模式让视角始终朝上，就像罗盘；北向上模式固定地图，改为旋转你的箭头。',
    'Pick the colour you lose least against the sunset. The crosshair always turns red over an enemy.':
      '选择在落日背景下最不显眼的颜色。准星压在敌人身上时始终变红。',
    'Size of the in-match HUD. Menus are not affected.': '对局内 HUD 的大小，不影响菜单。',
    'Shows the movement keys at the start of your first few matches.': '在最初几局开局时显示移动按键提示。',
    'Full resolution, 4× MSAA, ambient occlusion and 4K sun shadows. Recommended.': '4× MSAA、环境光遮蔽与 4K 太阳阴影；分辨率独立设置。',
    'High, plus sharper reflections, denser light shafts and up to 2× pixel density on high-DPI displays.':
      '高档特效基础上提供更锐利的反射、更密集的光束；不再额外提高像素密度。',

    /* ===== 枪匠 ===== */
    'WEAPON': '武器',
    'WEAPON CAMOS': '武器迷彩',
    'ATTACHMENTS': '配件',
    'SLOT': '槽位',
    'OPTION': '选项',
    'EQUIP': '装备',
    'SET PRIMARY': '设为主武器',
    'RESET': '重置',
    'RESET BUILD': '重置配置',
    'CONFIRM RESET': '确认重置',
    'EQUIPPED': '已装备',
    'EQUIPPED AS PRIMARY': '已装备为主武器',
    'EQUIP AS PRIMARY': '装备为主武器',
    'SIDEARM — ALWAYS CARRIED': '副武器 — 始终携带',
    'PRIMARY': '主武器',
    'SECONDARY': '副武器',
    'OPTIC': '瞄具',
    'MUZZLE': '枪口',
    'UNDERBARREL': '下挂',
    'MAGAZINE': '弹匣',
    'STOCK': '枪托',
    'DAMAGE': '伤害',
    'RANGE': '射程',
    'FIRE RATE': '射速',
    'ACCURACY': '精准度',
    'RECOIL CONTROL': '后坐力控制',
    'MOBILITY': '机动性',
    'HANDLING': '操控',
    'VERTICAL RECOIL': '垂直后坐力',
    'HORIZONTAL RECOIL': '水平后坐力',
    'ADS TIME': '开镜时间',
    'SPRINT-TO-FIRE': '冲刺转射击',
    'MOVE SPEED': '移动速度',
    'ADS MOVE SPEED': '开镜移动速度',
    'ZOOM': '倍率',
    'HIP SPREAD': '腰射散布',
    'RELOAD TIME': '装填时间',
    'MAG SIZE': '弹匣容量',
    'MUZZLE FLASH': '枪口火光',
    'SUPPRESSED': '消音',
    'LASER': '激光',
    'NO STAT CHANGE': '无数值变化',
    'FALL': '坠落',
    'DESTROYED': '已击毁',
    'ELIMINATED': '被击杀',
    'CAMO UNLOCKED': '迷彩已解锁',
    'MATCH START': '对局开始',
    'RANK': '军衔',
    'WIN': '胜',
    'SLIDE': '滑铲',
    'DIVE': '扑倒',
    'SPRINT ANY DIRECTION': '任意方向冲刺',
    'AUTO': '全自动',
    'SEMI': '半自动',
    'PUMP': '泵动',
    'MAG': '弹匣',
    'ADS': '开镜',
    'SPRINT': '冲刺',
    'MS': '毫秒',
    'M': '米',
    'STANDARD ISSUE': '制式',
    'MILITARY': '军用',
    'SPECIAL': '特种',
    'MASTERY': '精通',
    'COMPLETIONIST': '全收集',
    'AVAILABLE FROM THE START': '开局即可用',
    'UNLOCKED — ENTER TO EQUIP': '已解锁 — 按 Enter 装备',
    'LOCKED': '未解锁',
    'ALL CAMOS UNLOCKED': '全部迷彩已解锁',
    'CHALLENGE COMPLETE': '挑战完成',
    'ENEMY K9 DESTROYED': '敌方 K9 已击毁',
    'K9 TAKEDOWNS': 'K9 击倒',
    'K9 DESTROYED': '击毁 K9',
    'K9 TAKEDOWN': 'K9 击倒',
    'PACK LEADER': '群首',
    'HEADSHOT': '爆头',
    'HEADSHOTS': '爆头',
    'DOUBLE KILL': '双杀',
    'TRIPLE KILL': '三杀',
    'FURY KILL': '四杀',
    'FRENZY KILL': '五杀',
    'SLIDE KILL': '滑铲击杀',
    'DIVE KILL': '扑杀',
    'AIRBORNE': '空中击杀',
    'KNOCKOUT': '击倒',
    'FRAGGED': '手雷击杀',
    'LONGSHOT': '远距离击杀',
    'POINT BLANK': '贴脸击杀',
    'SURVIVOR': '绝境求生',
    'BLOODTHIRSTY': '嗜血',
    'MERCILESS': '无情',

    /* ===== 武器 ===== */
    'ASSAULT RIFLE': '突击步枪',
    'SUBMACHINE GUN': '冲锋枪',
    'SHOTGUN': '霰弹枪',
    'PISTOL': '手枪',
    'Balanced carbine. Wins the long lanes of the atrium.': '均衡型卡宾枪，擅长中庭的长通道。',
    'Fast-handling 9 mm. Owns corridors and the bar.': '反应迅捷的 9 毫米冲锋枪，走廊与酒吧的主宰。',
    'Pump-action 12 gauge. One trigger pull inside a room.': '泵动式 12 号霰弹枪，室内一枪定胜负。',
    'Striker-fired sidearm. Always on your hip.': '击针式副武器，永远挂在腰间。',

    /* ===== 配件 ===== */
    'IRON SIGHTS': '机械瞄具',
    'KITE REFLEX': '风筝红点',
    'HALO HOLOGRAPHIC': '光环全息',
    'VANTAGE 2.5×': '远眺 2.5×',
    'FACTORY MUZZLE': '原厂枪口',
    'MONOLITH SUPPRESSOR': '巨石消音器',
    'PORTED COMPENSATOR': '开孔补偿器',
    'SLOTTED BRAKE': '开槽制退器',
    'FULL CHOKE': '全收束器',
    'NO UNDERBARREL': '无下挂',
    'VERTICAL FOREGRIP': '垂直握把',
    'ANGLED FOREGRIP': '斜角握把',
    'TAC LASER': '战术激光',
    'STANDARD MAG': '标准弹匣',
    'EXTENDED MAG': '扩容弹匣',
    'SPEED MAG': '快速弹匣',
    'FACTORY STOCK': '原厂枪托',
    'SKELETON STOCK': '骨架枪托',
    'PADDED STOCK': '缓冲枪托',
    'Nothing between you and the target. Fastest to the eye.': '视野毫无遮挡，抬枪最快。',
    'Open red dot. Precise and quick.': '开放式红点，精准而迅速。',
    'Wide window with a ring-and-dot reticle.': '宽大视窗，环点式分划。',
    'Magnified prism sight for the long lanes.': '带倍率的棱镜瞄具，适合长通道。',
    'Standard flash hider.': '标准消焰器。',
    'Quiet report and a hidden flash. Enemies hear you late.': '枪声更低、火光隐蔽，敌人察觉你的时间更晚。',
    'Vents gas upward to hold the muzzle down.': '向上排气，压制枪口上跳。',
    'Kills side-to-side drift.': '消除左右漂移。',
    'Tighter pattern, longer reach.': '弹丸更集中，射程更远。',
    'Bare handguard.': '光裸护木。',
    'A firm hold that steadies sustained fire.': '稳固握持，持续射击更稳。',
    'Snappier to the shoulder and out of a sprint.': '更快进入抵肩状态，出冲刺更利落。',
    'Visible beam. Tightens hip fire.': '可见光束，收紧腰射散布。',
    'Factory capacity.': '原厂容量。',
    'Half again as many rounds; a little slower to handle.': '弹量增加五成，操控略慢。',
    'Flared well and a pull tab for faster changes.': '喇叭口弹匣井与拉环，换弹更快。',
    'Balanced.': '均衡。',
    'Light and fast; kicks harder.': '轻巧迅捷，后坐更猛。',
    'Soaks up recoil at the cost of speed.': '吸收后坐，牺牲速度。',

    /* ===== 迷彩 ===== */
    'FACTORY': '原厂',
    'DUNE': '沙丘',
    'TIMBERLINE': '林线',
    'FRACTURE': '碎裂',
    'TIGERSTRIPE': '虎纹',
    'EMBER TOPO': '余烬等高线',
    'CARBON WEAVE': '碳纤维',
    'DAMASCUS': '大马士革',
    'SOLSTICE GOLD': '至日金',
    'MOLTEN OBSIDIAN': '熔岩黑曜石',
    'As issued.': '出厂状态。',
    'Flat dark earth with worn edges.': '哑光深土色，边缘做旧。',
    'Hand-sprayed woodland through netting.': '隔着网布手喷的林地迷彩。',
    'Urban shards in three greys.': '三种灰度的城市碎块。',
    'Black brushstrokes over olive and tan.': '橄榄与浅棕底色上的黑色笔触。',
    'Burnt-orange contour lines on matte black.': '哑光黑底上的焦橙等高线。',
    'Twill-weave carbon under clear coat.': '清漆下的斜纹碳纤。',
    'Folded-steel waves, acid etched.': '酸蚀出的折叠钢纹。',
    'Polished gold with engraved scrollwork.': '抛光金面配雕花卷纹。',
    'Black glass with a slow ember glow in the cracks.': '黑色琉璃，裂纹中透出缓慢的余烬微光。',

    /* ===== 结算 ===== */
    'VICTORY': '胜利',
    'DEFEAT': '失败',
    'DRAW': '平局',
    'PROGRESSION': '进度',
    'RANK UP': '军衔提升',
    'MAX RANK': '满级',
    'CAMO PROGRESS': '迷彩进度',
    'YOUR PERFORMANCE': '你的表现',
    'MEDALS': '勋章',
    'MATCH MVP': '全场 MVP',
    'PLAY AGAIN': '再来一局',
    'MAIN MENU': '主菜单',
    'SCORE': '得分',
    'SCORES': '记分板',
    'DEATHS': '死亡',
    'K/D RATIO': 'K/D 比',
    'BEST STREAK': '最佳连杀',
    'SHOTS FIRED': '开火数',
    'TOTAL XP': '总经验',
    'NO MEDALS THIS MATCH': '本局无勋章',
    'UNLOCKED': '已解锁',
    'XP': '经验',
    'HP': '生命',
    'You': '你',
    'Gravity': '重力',
    'OUT OF BOUNDS': '脱离战场',
    'SELF-INFLICTED': '自我了断',
    'ELIMINATED BY': '击杀者',
    'RESPAWN IN': '重生倒计时',

    /* ===== 加载 ===== */
    'PREPARING': '准备中',
    'FIELD NOTES': '战地笔记',
    'INITIALISING RENDERER': '初始化渲染器',
    'PAINTING MATERIALS': '绘制材质',
    'LOADING HOTEL': '载入酒店场景',
    'BUILDING FURNITURE': '构建家具',
    'RAISING THE HOTEL': '搭建酒店',
    'DRESSING THE LOBBY': '布置大堂',
    'DETAILING': '细化细节',
    'CAPTURING LIGHT': '捕捉光线',
    'MAPPING ROUTES': '规划路线',
    'ASSEMBLING WEAPONS': '组装武器',
    'PREPARING THE ARMOURY': '准备军械库',
    'BRIEFING OPERATORS': '简报干员',
    'FINAL CHECKS': '最终检查',
    'READY': '就绪',
    'Sprint works in <b>every direction</b>. Strafe-sprint out of a bad angle instead of turning your back.':
      '冲刺在<b>任意方向</b>都有效。角度不利时横向冲刺脱离，不必转身露出后背。',
    'Slide with <b>C</b> while sprinting to take a corner low and fast. Slide kills earn a medal.':
      '冲刺中按 <b>C</b> 滑铲，低姿高速过弯。滑铲击杀可获得勋章。',
    'Dive with <b>X</b> through a window: every pane in the hotel breaks.': '按 <b>X</b> 扑穿窗户：酒店里每一块玻璃都会碎。',
    'Bullets punch through thin cover. Wooden slats, plaster and furniture will not save anyone.':
      '子弹能打穿薄掩体。木条、石膏和家具救不了任何人。',
    'Enemies appear on your minimap when they <b>fire</b>. A suppressor keeps bots from hearing you early.':
      '敌人<b>开火</b>时会出现在小地图上。消音器能让 AI 更晚听到你。',
    'The atrium chandelier is not decoration. Shoot the mount when somebody stands underneath.':
      '中庭吊灯不是摆设。有人站在下面时，打它的挂点。',
    'Health regenerates after a few seconds out of the fight. Break line of sight, then re-engage.':
      '脱离交火几秒后生命会恢复。先切断视线，再重新接战。',
    'Headshots unlock the Tigerstripe and Ember Topo camos. Build each weapon in the <b>Gunsmith</b>.':
      '爆头可解锁虎纹与余烬等高线迷彩。在<b>枪匠</b>里改装每把武器。',
    'The balcony ring sees the whole lobby. So does everyone looking up at it.':
      '环形露台能俯瞰整个大堂——抬头看它的人也一样。',
    'Empty magazine? Swapping to your sidearm with <b>2</b> is always faster than reloading.':
      '弹匣打空？按 <b>2</b> 换副武器永远比装填快。',
    'Your <b>K9 unit</b> charges while you fight. Press <b>B</b> to unleash it: it hunts on its own until its battery runs out.':
      '战斗时<b>K9 军犬</b>会充能。按 <b>B</b> 放出，它会自行猎杀直到电量耗尽。',
    'An <b>enemy K9</b> can be shot down. Watch the red edge marker, turn toward it and fire before it leaps.':
      '<b>敌方 K9</b>可以击毁。留意屏幕边缘的红色标记，在它扑上来之前转身开火。',

    /* ===== HUD ===== */
    'K9': 'K9',
    'K9 UNIT INBOUND': 'K9 军犬来袭',
    'K9 UNLEASHED': 'K9 已放出',
    'HUNTING HOSTILES': '正在猎杀敌人',
    'K9 UNIT DESTROYED': 'K9 已被击毁',
    'K9 BATTERY DEPLETED': 'K9 电量耗尽',
    'RECHARGING': '充能中',
    'ENEMY K9 INBOUND': '敌方 K9 来袭',
    'HOSTILE UNIT HUNTING — SHOOT IT DOWN': '敌方单位正在猎杀 — 击毁它',
    'K9 UNIT ALREADY HUNTING': 'K9 已在猎杀中',
    'K9 UNIT READY': 'K9 军犬就绪',
    'K9 UNIT CHARGING': 'K9 军犬充能中',
    'BY YOU': '由你击毁',
    'MATCH POINT': '赛点',
    'NEED ONE ELIMINATION': '还差一次击杀',
    'VANGUARD NEED ONE ELIMINATION': '先锋还差一次击杀',
    'EMBER NEED ONE ELIMINATION': '余烬还差一次击杀',
    'LEAD TAKEN': '取得领先',
    'LEAD LOST': '失去领先',
    'SCORES TIED': '比分持平',
    'ONE MINUTE REMAINING': '剩余一分钟',
    '30 SECONDS': '剩余 30 秒',
    'TIME LIMIT REACHED': '时间到',
    'FINAL KILL': '最后一击',
    'RELOADING': '装填中',
    'NO AMMO': '没有弹药',
    'LOW AMMO': '弹药不足',

    /* ===== 区域 ===== */
    'ATRIUM LOBBY': '中庭大堂',
    'EMBER BAR': '余烬酒吧',
    'RESTAURANT': '餐厅',
    'SERVICE CORRIDOR': '后勤走廊',
    'KITCHEN': '厨房',
    'EAST CORRIDOR': '东走廊',
    'CONFERENCE': '会议厅',
    'SUITE': '套房',
    'POOL': '泳池',
    'TERRACE': '露台',
    'BALCONY': '露台环廊',
    'CHANDELIER': '吊灯'
  };

  var RULES = [
    [/^FIRST TO (\d+) ELIMINATIONS$/, function (m) { return '先到 ' + m[1] + ' 次击杀'; }],
    [/^BY (.+)$/, function (m) { return '由 ' + m[1] + ' 击毁'; }],
    [/^FIRST TO (\d+) · (.+)$/, function (m) { return '先到 ' + m[1] + ' · ' + m[2]; }],
    [/^([+−-]\d+)% (.+)$/, function (m) { return m[1] + '% ' + (DICT[m[2]] || m[2]); }],
    [/^Charges in (\d+) s · hunts for (\d+) s$/, function (m) { return '每 ' + m[1] + ' 秒充能 · 猎杀 ' + m[2] + ' 秒'; }],
    [/^(\d+)M$/, function (m) { return m[1] + ' 米'; }],
    [/^(\d+) \/ (\d+) ATTACHMENTS$/, function (m) { return '配件 ' + m[1] + ' / ' + m[2]; }],
    [/^(\d+) \/ (\d+) CAMOS$/, function (m) { return '迷彩 ' + m[1] + ' / ' + m[2]; }],
    [/^(.+?) · (\d+) ATT$/, function (m) { return m[1] + ' · 配件 ' + m[2]; }],
    [/^TIER (\d+) · (.+)$/, function (m) { return '等级 ' + m[1] + ' · ' + (DICT[m[2]] || m[2]); }],
    [/^(\d+) \/ (\d+) UNLOCKED$/, function (m) { return '已解锁 ' + m[1] + ' / ' + m[2]; }],
    [/^(\d+)\/(\d+) ELIMINATIONS$/, function (m) { return m[1] + '/' + m[2] + ' 次击杀'; }],
    [/^(\d+)\/(\d+) HEADSHOTS$/, function (m) { return m[1] + '/' + m[2] + ' 次爆头'; }],
    [/^([\d,]+) ELIMS · ([\d,]+) HEADSHOTS$/, function (m) { return '击杀 ' + m[1] + ' · 爆头 ' + m[2]; }],
    [/^GOLD ON (\d+)\/(\d+) WEAPONS$/, function (m) { return m[2] + ' 把武器中 ' + m[1] + ' 把已镀金'; }],
    [/^NEXT · (.+)$/, function (m) { return '下一个 · ' + (DICT[m[1]] || m[1]); }],
    [/^RANK (\d+)$/, function (m) { return '军衔 ' + m[1]; }],
    [/^([\d,]+) \/ ([\d,]+) XP$/, function (m) { return m[1] + ' / ' + m[2] + ' 经验'; }],
    [/^MATCH SCORE\s*\+([\d,]+)$/, function (m) { return '对局得分 +' + m[1]; }],
    [/^VICTORY BONUS\s*\+([\d,]+)$/, function (m) { return '胜利奖励 +' + m[1]; }],
    [/^COMPLETION BONUS\s*\+([\d,]+)$/, function (m) { return '完成奖励 +' + m[1]; }],
    [/^(\d+) K\s+(\d+) D\s+([\d,]+)$/, function (m) { return m[1] + ' 杀 ' + m[2] + ' 死 ' + m[3] + ' 分'; }],
    [/^(\d+):(\d\d) REMAINING$/, function (m) { return '剩余 ' + m[1] + ':' + m[2]; }],
    [/^(\d+) TAKEDOWNS? · RECHARGING$/, function (m) { return '击倒 ' + m[1] + ' 次 · 充能中'; }],
    [/^(VANGUARD|EMBER) (\d+) — (\d+)$/, function (m) { return (DICT[m[1]] || m[1]) + ' ' + m[2] + ' — ' + m[3]; }],
    [/^(VANGUARD|EMBER) WIN (\d+) — (\d+)$/, function (m) { return (DICT[m[1]] || m[1]) + '获胜 ' + m[2] + ' — ' + m[3]; }],
    [/^(\d+) HP$/, function (m) { return m[1] + ' 生命'; }],
    [/^(.+) APPLIED$/, function (m) { return (DICT[m[1]] || m[1]) + ' 已应用'; }],
    [/^(.+) FITTED$/, function (m) { return (DICT[m[1]] || m[1]) + ' 已装配'; }],
    [/^(.+) RESTORED$/, function (m) { return (DICT[m[1]] || m[1]) + ' 已恢复原厂'; }],
    [/^(.+) SET AS PRIMARY$/, function (m) { return (DICT[m[1]] || m[1]) + ' 已设为主武器'; }],
    [/^([\d,]+) ELIMS$/, function (m) { return '击杀 ' + m[1]; }],
    [/^(\d+) KILLS$/, function (m) { return m[1] + ' 次击杀'; }],
    [/^(\d+) \/ (\d+)$/, function (m) { return m[1] + ' / ' + m[2]; }]
  ];

  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  var SKIP = { SCRIPT: 1, STYLE: 1, CANVAS: 1, NOSCRIPT: 1, TEXTAREA: 1 };

  /* 含内联标签的文案，按 innerHTML 整体替换 */
  var HTML_DICT = {
    'Sprint works in <b>every direction</b>. Strafe-sprint out of a bad angle instead of turning your back.':
      '冲刺在<b>任意方向</b>都有效。角度不利时横向冲刺脱离，不必转身露出后背。',
    'Slide with <b>C</b> while sprinting to take a corner low and fast. Slide kills earn a medal.':
      '冲刺中按 <b>C</b> 滑铲，低姿高速过弯。滑铲击杀可获得勋章。',
    'Dive with <b>X</b> through a window: every pane in the hotel breaks.':
      '按 <b>X</b> 扑穿窗户：酒店里每一块玻璃都会碎。',
    'Bullets punch through thin cover. Wooden slats, plaster and furniture will not save anyone.':
      '子弹能打穿薄掩体。木条、石膏和家具救不了任何人。',
    'Enemies appear on your minimap when they <b>fire</b>. A suppressor keeps bots from hearing you early.':
      '敌人<b>开火</b>时会出现在小地图上。消音器能让 AI 更晚听到你。',
    'The atrium chandelier is not decoration. Shoot the mount when somebody stands underneath.':
      '中庭吊灯不是摆设。有人站在下面时，打它的挂点。',
    'Health regenerates after a few seconds out of the fight. Break line of sight, then re-engage.':
      '脱离交火几秒后生命会恢复。先切断视线，再重新接战。',
    'Headshots unlock the Tigerstripe and Ember Topo camos. Build each weapon in the <b>Gunsmith</b>.':
      '爆头可解锁虎纹与余烬等高线迷彩。在<b>枪匠</b>里改装每把武器。',
    'The balcony ring sees the whole lobby. So does everyone looking up at it.':
      '环形露台能俯瞰整个大堂——抬头看它的人也一样。',
    'Empty magazine? Swapping to your sidearm with <b>2</b> is always faster than reloading.':
      '弹匣打空？按 <b>2</b> 换副武器永远比装填快。',
    'Your <b>K9 unit</b> charges while you fight. Press <b>B</b> to unleash it: it hunts on its own until its battery runs out.':
      '战斗时<b>K9 军犬</b>会充能。按 <b>B</b> 放出，它会自行猎杀直到电量耗尽。',
    'An <b>enemy K9</b> can be shot down. Watch the red edge marker, turn toward it and fire before it leaps.':
      '<b>敌方 K9</b>可以击毁。留意屏幕边缘的红色标记，在它扑上来之前转身开火。'
  };

  function translateText(raw) {
    if (!raw) return null;
    var lead = raw.match(/^\s*/)[0];
    var tail = raw.match(/\s*$/)[0];
    var core = raw.slice(lead.length, raw.length - tail.length)
      .replace(/ /g, ' ').replace(/\s+/g, ' ');
    if (!core) return null;
    var out = DICT[core];
    if (out === undefined && core.indexOf(' · ') > 0) {
      var parts = core.split(' · ');
      var mapped = parts.map(function (p) { return DICT[p]; });
      var ok = mapped.every(function (x) { return x !== undefined; });
      if (ok) out = mapped.join(' · ');
    }
    if (out === undefined) {
      for (var i = 0; i < RULES.length; i++) {
        var m = core.match(RULES[i][0]);
        if (m) { out = RULES[i][1](m); break; }
      }
    }
    if (out === undefined || out === core) return null;
    return lead + out + tail;
  }

  function translateNode(node) {
    if (!node || !node.nodeValue) return;
    var v = node.nodeValue;
    if (!/[A-Za-z]/.test(v)) return;
    var out = translateText(v);
    if (out !== null && out !== v) node.nodeValue = out;
  }

  function translateElement(el) {
    if (!el || el.nodeType !== 1) return;
    if (SKIP[el.tagName]) return;
    if (el.id === 'ltipp') {
      var h = HTML_DICT[el.innerHTML];
      if (h) { el.innerHTML = h; return; }
    }
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      if (el.hasAttribute && el.hasAttribute(a)) {
        var v = el.getAttribute(a);
        if (!v) continue;
        var o = DICT[v];
        if (o !== undefined && o !== v) el.setAttribute(a, o);
      }
    }
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { translateNode(root); return; }
    if (root.nodeType !== 1) return;
    if (SKIP[root.tagName]) return;
    translateElement(root);
    var stack = [root];
    while (stack.length) {
      var el = stack.pop();
      if (el.nodeType === 1) translateElement(el);
      var kids = el.childNodes;
      for (var i = 0; i < kids.length; i++) {
        var k = kids[i];
        if (k.nodeType === 3) translateNode(k);
        else if (k.nodeType === 1 && !SKIP[k.tagName]) {
          if (k.id === 'ltipp') translateElement(k);
          else stack.push(k);
        }
      }
    }
  }

  function start() {
    walk(document.body);
    var mo = new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) {
        var r = list[i];
        if (r.type === 'characterData') translateNode(r.target);
        else if (r.type === 'childList') {
          if (r.target && r.target.id === 'ltipp') translateElement(r.target);
          for (var j = 0; j < r.addedNodes.length; j++) walk(r.addedNodes[j]);
        } else if (r.type === 'attributes') translateElement(r.target);
      }
    });
    mo.observe(document.body, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ATTRS
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();