
import { createWorkspaceDocument } from '../../../src/workspaces/document.js';
import { createWorkspaceRestoreCoordinator } from '../../../src/workspaces/restore.js';
let releaseRollback, enteredRollback;
const rollbackEntered = new Promise(resolve => { enteredRollback=resolve; });
const rollbackWait = new Promise(resolve => { releaseRollback=resolve; });
const events=[];
const coordinator = createWorkspaceRestoreCoordinator({
 storage:{getWorkspace: async id => ({document:createWorkspaceDocument({id,title:id,view:{camera:{lat:0,lon:0}}}),chunks:{},assets:{}})},
 captureCurrent: async()=>({before:true}),
 apply:async document=>{ if(document.id==='slow') throw new Error('older workspace failed'); return document.id; },
 rollback:async()=>{enteredRollback(); await rollbackWait;}
});
coordinator.subscribe(s=>events.push({...s}));
const old=coordinator.restore('slow');
await rollbackEntered;
const newer=await coordinator.restore('newer');
const beforeLate={...coordinator.getState()};
releaseRollback();
const oldResult=await old;
const afterLate={...coordinator.getState()};
coordinator.destroy();
console.log(JSON.stringify({newerStatus:newer.status,oldStatus:oldResult.status,beforeLate,afterLate,events,staleStatusOverwrite:beforeLate.status==='applied'&&afterLate.status==='failed'},null,2));
