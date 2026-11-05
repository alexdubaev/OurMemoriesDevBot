import assert from 'node:assert/strict'
import { Client } from 'pg'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
export async function verifyS3AlbumSocialMigrationRoute(root, proposed) {
root=resolve(root); proposed=resolve(proposed)
const candidate='a18469ab8a54464d491659d849fcf286973fa9e4'
function git(...args){const r=spawnSync('git',args,{cwd:root,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout}
const paths=git('ls-tree','-r','--name-only',candidate,'--','backend/prisma/migrations/').trim().split('\n').filter(p=>p.endsWith('/migration.sql')).sort()
assert.equal(paths.length,65)
const adminUrl=new URL(process.env.TEST_DATABASE_URL);assert.equal(adminUrl.hostname,'127.0.0.1');assert.match(adminUrl.pathname,/_test$/)
const admin=new Client({connectionString:adminUrl.toString()});await admin.connect()
const scratch=resolve(root,'.scratch');mkdirSync(scratch,{recursive:true})
const fixture=mkdtempSync(resolve(scratch,'s3-route-proof-'));let cases=0
const archivedRoot=resolve(fixture,'accepted-source');mkdirSync(archivedRoot,{recursive:true})
const archive=spawnSync('git',['archive',candidate,'backend'],{cwd:root,maxBuffer:64*1024*1024})
assert.equal(archive.status,0,archive.stderr?.toString())
const extracted=spawnSync('tar',['-x','-C',archivedRoot],{input:archive.stdout})
assert.equal(extracted.status,0,extracted.stderr?.toString())
const historicalBackend=resolve(archivedRoot,'backend')
const generated=spawnSync('bun',['run','prisma:generate'],{cwd:historicalBackend,env:{...process.env,DATABASE_URL:adminUrl.toString()},encoding:'utf8',timeout:90000,maxBuffer:4*1024*1024})
assert.equal(generated.status,0,generated.stdout+'\n'+generated.stderr)
const originalLegacy=resolve(fixture,'reviewed-max63-redeploy.sh');writeFileSync(originalLegacy,git('show','6de3da8eb4588b3fe3ebe14016ea0c8ae35c69ab:deploy/selectel/redeploy.sh'))
const q=s=>`'${String(s).replaceAll("'","'\\''")}'`
async function withDb(count,body){
 const name=`s3_route_${randomUUID().replaceAll('-','')}_test`,url=new URL(adminUrl);url.pathname='/'+name
 await admin.query(`CREATE DATABASE "${name}"`)
 const db=new Client({connectionString:url.toString()});await db.connect()
 try{
  await db.query('CREATE TABLE _prisma_migrations (id varchar(36) PRIMARY KEY, checksum varchar(64) NOT NULL, finished_at timestamptz, migration_name varchar(255) NOT NULL, logs text, rolled_back_at timestamptz, started_at timestamptz NOT NULL DEFAULT now(), applied_steps_count integer NOT NULL DEFAULT 0)')
  for(let i=0;i<count;i++){
   const path=paths[i],sql=git('show',`${candidate}:${path}`).replaceAll('\r\n','\n');await db.query(sql)
   await db.query('INSERT INTO _prisma_migrations (id,checksum,migration_name,finished_at,applied_steps_count) VALUES ($1,$2,$3,now(),1)',[randomUUID(),createHash('sha256').update(i%2?sql.replaceAll('\n','\r\n'):sql).digest('hex'),path.split('/').at(-2)])
  }
  await db.query("CREATE TABLE route_sentinel(value text); INSERT INTO route_sentinel VALUES ('synthetic preserved data')")
  await body(db,url.toString())
 }finally{await db.end();await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`)}
}
const snapshot=db=>db.query('SELECT * FROM _prisma_migrations ORDER BY migration_name').then(r=>r.rows)
function run(url,options={}){
 const server=mkdtempSync(resolve(fixture,'server-'));mkdirSync(resolve(server,'backups'))
 const events=resolve(server,'events')
 const env={...process.env,DATABASE_URL:url,TEST_DATABASE_URL:url,NODE_ENV:'test',CHECKPOINT_DISABLE:'1',MAX_ENABLED:'true',
  MAX_BOT_TOKEN:'987654:route-proof-synthetic',MAX_BOT_EXPECTED_USERNAME:'OurMemoriesMaxBot',MAX_WEBHOOK_URL:'https://max.example.invalid/webhook',
  MAX_WEBHOOK_SECRET:'M'.repeat(43),MAX_INBOX_ENCRYPTION_KEY:'B'.repeat(43),MAX_MINI_APP_URL:'https://app.example.invalid',JWT_SECRET:'route-proof-synthetic-secret-0123456789',
  PRIVATE_STORAGE_DRIVER:options.storage??'s3',PRIVATE_STORAGE_ENDPOINT:'https://s3.example.invalid',PRIVATE_STORAGE_REGION:'us-east-1',PRIVATE_STORAGE_BUCKET:'synthetic-route-proof',
  PRIVATE_STORAGE_ACCESS_KEY_ID:'synthetic-only',PRIVATE_STORAGE_SECRET_ACCESS_KEY:'synthetic-only-not-provider',PRIVATE_STORAGE_FORCE_PATH_STYLE:'true',PRIVATE_STORAGE_ALLOW_REMOTE_ENDPOINT:'true',
  SERVER_ROOT:server,APP_ROOT:root,HISTORICAL_BACKEND_ROOT:historicalBackend,MEMOLY_PRODUCT_SHA:options.source??candidate,FIXTURE_EVENTS:events,SELECTEL_CI_RELEASE:options.ci===false?'false':'true',SELECTEL_DEPLOY_LOCK_FD:options.lock===false?'':'9',
  ADMIN_SEED_EMAIL:'',ADMIN_SEED_PASSWORD:'',DATABASE_RUNTIME_USER:''}
 const script=`. ${q(options.script??proposed)}
preflight(){ echo PREFLIGHT >> "$FIXTURE_EVENTS"; }
validate_database_target(){ echo TARGET >> "$FIXTURE_EVENTS"; }
backup_database(){ echo BACKUP >> "$FIXTURE_EVENTS"; }
quiesce_all_writers(){ echo UNEXPECTED_QUIESCE >> "$FIXTURE_EVENTS"; return 74; }
compose(){
 if [[ "$*" == *"loadEnv(process.env)"* || "$*" == *"MEMOLY_S3_SOCIAL_PHASE="* ]]; then command bun -e "\${!#}"; return; fi
 if [[ "$*" == *"deploy-selectel-database.ts"* ]]; then echo SQL_JOB >> "$FIXTURE_EVENTS"; (cd "$HISTORICAL_BACKEND_ROOT" && command bun scripts/deploy-selectel-database.ts); return; fi
 if [[ "$*" == *"prisma migrate status"* ]]; then echo MIGRATION_STATUS >> "$FIXTURE_EVENTS"; (cd "$HISTORICAL_BACKEND_ROOT" && command bunx --bun prisma migrate status); return; fi
 return 90
}
${options.lock===false?'':`exec 9>"$SERVER_ROOT/${options.wrongLock?'wrong.lock':'.selectel-deploy.lock'}"; flock -n 9`}
${options.legacy?`rollback_source_compatibility_profile(){ [ "$2" = "$S3_RECOVERY_SHA" ] && return 1; printf 'max-video\\n'; }
rollback_verify_max_video_migration_history(){ echo LEGACY_PREFIX >> "$FIXTURE_EVENTS"; }
quiesce_all_writers(){ echo LEGACY_QUIESCE >> "$FIXTURE_EVENTS"; return 73; }`:''}
migrate
`
 const r=spawnSync('bash',['-s'],{input:script,cwd:resolve(root,'backend'),env,encoding:'utf8',timeout:90000,maxBuffer:4*1024*1024})
 let eventText='';try{eventText=readFileSync(events,'utf8')}catch{}
 return {...r,events:eventText,server}
}
async function reject(db,url,options,label){
 const before=await snapshot(db),r=run(url,options)
 assert.notEqual(r.status,0,label+' accepted');assert.match(r.events,/BACKUP/);assert.doesNotMatch(r.events,/SQL_JOB|MIGRATION_STATUS|QUIESCE/)
 assert.deepEqual(await snapshot(db),before)
 assert.deepEqual((await db.query('SELECT value FROM route_sentinel')).rows,[{value:'synthetic preserved data'}])
 console.log(`REJECT ${label}: before SQL, ledger/data unchanged`);cases++
}
try{
 for(const count of [63,64,65])await withDb(count,async(db,url)=>{
  const before=await snapshot(db),r=run(url)
  if(r.status!==0){const logs=readdirSync(resolve(r.server,'backups')).filter(n=>n.startsWith('selectel-db-deploy.')).map(n=>readFileSync(resolve(r.server,'backups',n),'utf8')).join('\n');const error=Error(r.stdout+r.stderr+logs);error.events=r.events;error.beforeSql=!r.events.includes('SQL_JOB');throw error}
  assert.equal(r.status,0);assert.match(r.events,/BACKUP\nSQL_JOB\nMIGRATION_STATUS/);assert.doesNotMatch(r.events,/QUIESCE/)
  const after=await snapshot(db);assert.equal(after.length,65);assert.deepEqual(after.slice(0,count),before)
  assert.equal((await db.query("SELECT to_regclass('album_entry_comments') IS NOT NULL AS present")).rows[0].present,true)
  assert.equal((await db.query("SELECT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='album_entries_legacy_clear_discussion' AND tgenabled='O') AS present")).rows[0].present,true)
  assert.deepEqual((await db.query('SELECT value FROM route_sentinel')).rows,[{value:'synthetic preserved data'}])
  console.log(`PASS real guarded ownership→Prisma→grants ${count}→65; original prefix/data preserved`);cases++
 })
 await withDb(63,async(db,url)=>{
 for(const [opts,label] of [[{source:'7679a9de70f798e6d495569c27fc6751e53c9b8e'},'unattested source'],[{storage:'filesystem'},'non-S3 storage'],[{ci:false},'not guarded release'],[{lock:false},'missing inherited lock'],[{wrongLock:true},'wrong inherited lock']])await reject(db,url,opts,label)
  const first=(await db.query('SELECT id,checksum FROM _prisma_migrations ORDER BY migration_name LIMIT 1')).rows[0]
  for(const [change,label] of [["checksum=repeat('0',64)",'SQL checksum drift'],['finished_at=NULL','unfinished prefix'],['rolled_back_at=now()','rolled-back prefix']]){
   await db.query(`UPDATE _prisma_migrations SET ${change} WHERE id=$1`,[first.id]);await reject(db,url,{},label)
   await db.query('UPDATE _prisma_migrations SET checksum=$2,finished_at=now(),rolled_back_at=NULL WHERE id=$1',[first.id,first.checksum])
  }
  const id=randomUUID();await db.query("INSERT INTO _prisma_migrations(id,checksum,migration_name,finished_at) VALUES($1,repeat('a',64),'20990101000000_foreign',now())",[id]);await reject(db,url,{},'foreign suffix');await db.query('DELETE FROM _prisma_migrations WHERE id=$1',[id])
  const original=run(url,{legacy:true,script:originalLegacy}),next=run(url,{legacy:true})
  assert.equal(original.status,73);assert.equal(next.status,73);assert.equal(next.events,original.events);assert.match(next.events,/BACKUP\nLEGACY_PREFIX\nLEGACY_QUIESCE/);assert.doesNotMatch(next.events,/SQL_JOB/)
  console.log('PASS original MAX profile route/validation/quiescence byte-identical order; stopped before SQL in both');cases++
 })
 await withDb(62,(db,url)=>reject(db,url,{},'incomplete baseline62'))
 console.log(`ROUTE PROPOSAL PASS: ${cases} bounded cases; actual SQL job used for three transitions; no production/S3 provider mutation`)
return {cases}
}finally{await admin.end();rmSync(fixture,{recursive:true,force:true})}
}
