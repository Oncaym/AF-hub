/* Two languages for the prototype; Korean strings come later (falls back to English). */
const S = {
  en: {
    projects: 'Projects', signout: 'Sign out', demo: 'Demo — changes stay in this browser only',
    installed: 'Installed', site: 'On site', factory: 'In factory', none: 'Not started',
    notStarted: 'Not started', inProgress: 'In progress', open: 'Open', items: 'items',
    pm: 'PM', gc: 'GC', thisWeek: 'This week', nothingThisWeek: 'Nothing installed in the last 7 days',
    plan: 'Plan', elevations: 'Elevations', floors: 'Floors', search: 'Search a number…',
    log: 'Log', rfi: 'RFI', submittals: 'Submittals', progressTab: 'Progress', comingNext: 'Coming next — this tab is not built yet.',
    noPlan: 'Plan not uploaded yet', noItems: 'No items yet — the takeoff comes in when it is ready.',
    markToday: 'Mark today', clear: 'Undo', by: 'by', change: 'Change date',
    issue: 'Issue', reportIssue: 'Report an issue', issueText: 'What is wrong?', save: 'Save', resolve: 'Resolve', openIssue: 'Open issue',
    history: 'History', noHistory: 'No changes yet.', close: 'Close', allInstalled: 'All installed',
    readOnly: 'View only', role: 'Role', admin: 'Admin',
    signInTitle: 'Sign in', email: 'Email', password: 'Password', sendLink: 'Email me a sign-in link',
    usePassword: 'Use a password instead', useLink: 'Use a sign-in link instead', signIn: 'Sign in',
    linkSent: 'Check your email — the link signs you in on this device.', confirmEmail: 'Confirm your email to finish signing in',
    noProjects: 'You are not on any project yet. Ask Leo or your PM to add you.',
    oldTracker: 'Still on its old tracker', positionsPending: 'Plan positions for these openings come with the import from the old tracker.',
    members: 'Members', invite: 'Add', loadSeed: 'Load into database', loaded: 'Loaded', seeds: 'Projects to load',
    stageNames: { factory: 'In factory', site: 'On site', installed: 'Installed' }
  },
  zh: {
    projects: '项目', signout: '退出', demo: '演示模式 — 改动只存在这个浏览器里',
    installed: '已安装', site: '到工地', factory: '工厂加工中', none: '未开始',
    notStarted: '未开工', inProgress: '施工中', open: '打开', items: '件',
    pm: 'PM', gc: '总包', thisWeek: '本周', nothingThisWeek: '最近 7 天没有安装',
    plan: '平面图', elevations: '立面', floors: '楼层', search: '搜编号…',
    log: '日志', rfi: 'RFI', submittals: 'Submittal', progressTab: '进度', comingNext: '下一步做 — 这个页面还没做。',
    noPlan: '平面图还没上传', noItems: '还没有构件 — takeoff 到了再导入。',
    markToday: '标为今天', clear: '撤回', by: '', change: '改日期',
    issue: '问题', reportIssue: '报问题', issueText: '什么问题？', save: '保存', resolve: '已解决', openIssue: '有问题',
    history: '记录', noHistory: '还没有改动。', close: '关闭', allInstalled: '全部装完',
    readOnly: '只能查看', role: '角色', admin: '管理员',
    signInTitle: '登录', email: '邮箱', password: '密码', sendLink: '发登录链接到邮箱',
    usePassword: '改用密码登录', useLink: '改用邮箱链接登录', signIn: '登录',
    linkSent: '去邮箱点链接 — 在这台设备上打开就登录了。', confirmEmail: '再输一次邮箱完成登录',
    noProjects: '你还没被加进任何项目，请找 Leo 或你的 PM。',
    oldTracker: '还在旧 tracker 上', positionsPending: '这些开口在平面图上的位置，等从旧 tracker 导入后才有。',
    members: '成员', invite: '添加', loadSeed: '导入数据库', loaded: '已导入', seeds: '待导入的项目',
    stageNames: { factory: '工厂加工中', site: '到工地', installed: '已安装' }
  }
};
let lang = 'en';
try {
  lang = localStorage.getItem('afv2-lang') || ((navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en');
} catch (e) {}
export const t = k => (S[lang] && S[lang][k] !== undefined ? S[lang][k] : S.en[k] !== undefined ? S.en[k] : k);
export const getLang = () => lang;
export function setLang(l) { lang = S[l] ? l : 'en'; try { localStorage.setItem('afv2-lang', lang); } catch (e) {} }
export const L = (obj, key = 'label') => (lang === 'zh' && obj && obj[key + 'Zh']) ? obj[key + 'Zh'] : (obj ? obj[key] : '');
