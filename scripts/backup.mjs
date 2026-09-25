import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, existsSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';
const data=resolve(process.env.DATA_DIR||'./data');
const directory=resolve(process.env.BACKUP_DIR||'/app/backups');
const source=join(data,'classroom.sqlite');
if(!existsSync(source))throw new Error('尚未创建数据库，无需备份。');
mkdirSync(directory,{recursive:true,mode:0o700});
const destination=join(directory,`tongbanji-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`);
const db=new DatabaseSync(source,{readOnly:true});
try{await backup(db,destination);chmodSync(destination,0o600);console.log(`备份已保存：${destination}`)}finally{db.close()}
