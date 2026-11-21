import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const { HookCast } = await import(new URL('hook-physics.js', base));

const origin=()=>new T.Vector3(0,1.6,0);
const item=()=>({id:7,token:'spawn-one',type:'wood',x:10,z:0});
function step(cast,seconds,items,reeling=false){const events=[];for(let t=0;t<seconds;t+=.02){const e=cast.update(.02,{hand:origin(),items,reeling,time:t});if(e)events.push(e);}return events;}

test('catching a supply requires reeling before collection and pays once',()=>{
 const items=[item()],cast=new HookCast(T,{origin:origin(),target:new T.Vector3(10,.05,0),charge:1});
 assert.equal(step(cast,2,items).length,0);
 assert.equal(cast.caught?.token,'spawn-one');
 assert.notEqual(cast.stage,'done');
 const events=step(cast,4,items,true);
 assert.equal(events.filter(e=>e.kind==='collected').length,1);
 assert.equal(events.find(e=>e.kind==='collected').token,'spawn-one');
 assert.equal(step(cast,2,items,true).length,0);
});
test('a missed throw can be reeled back without awarding supplies',()=>{
 const cast=new HookCast(T,{origin:origin(),target:new T.Vector3(10,.05,0),charge:1});
 step(cast,2,[]);const events=step(cast,4,[],true);
 assert.equal(cast.stage,'done');assert.equal(events.some(e=>e.kind==='collected'),false);
});
test('a respawned item cannot be collected with an old attachment',()=>{
 const cast=new HookCast(T,{origin:origin(),target:new T.Vector3(10,.05,0),charge:1});
 step(cast,2,[item()]);assert.equal(cast.caught?.token,'spawn-one');
 const events=step(cast,4,[{...item(),token:'spawn-two',x:40}],true);
 assert.equal(events.some(e=>e.kind==='collected'),false);
});
test('throw charging limits range and never mutates supplied vectors or debris',()=>{
 const from=origin(),target=new T.Vector3(100,.05,0),items=[item()];
 const before=JSON.stringify({from,target,items});
 const cast=new HookCast(T,{origin:from,target,charge:0,maxRange:26});
 step(cast,2,items);
 assert.ok(Math.hypot(cast.position.x,cast.position.z)<5);
 assert.equal(JSON.stringify({from,target,items}),before);
 const points=cast.ropePoints(from,16);assert.ok(points.length>=2);assert.ok(points.every(v=>Number.isFinite(v.x+v.y+v.z)));
});
