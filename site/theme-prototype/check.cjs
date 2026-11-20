const fs = require('fs'), path = require('path');
const h = fs.readFileSync(path.join(__dirname, 'site-theme-prototype.html'), 'utf8');
const s = h.match(/<script>([\s\S]*?)<\/script>/g)[1].replace(/<\/?script>/g, '');
new Function(s);
const names = [...h.matchAll(/\{ n: '(aw-[a-z-]+)', (?:inv|proc|o)/g)].map(m => m[1]);
const plugin = require(path.join(__dirname, '../../.claude-plugin/plugin.json')).skills.map(x => x.split('/').pop());
console.log('script ok; skill rows', names.length, 'missing', plugin.filter(p => !names.includes(p)), 'extra', names.filter(n => !plugin.includes(n)));
