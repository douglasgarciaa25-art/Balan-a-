import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const files=readdirSync('.').filter(f=>/\.(js|css|html|webmanifest|png)$/.test(f)&&f!=='sw.js').sort();
const hash=createHash('sha256');for(const file of files)hash.update(readFileSync(file));
let sw=readFileSync('sw.js','utf8').replace(/balanca-pwa-v2-[a-z0-9]+/,'balanca-pwa-v2-'+hash.digest('hex').slice(0,16));
for(const file of ['layout.js','calculator.js','speed.js','logo-cmoc.png','inventory.js'])if(!sw.includes('"./'+file+'"'))sw=sw.replace('"./install.js",','"./install.js","./'+file+'",');
writeFileSync('sw.js',sw);
