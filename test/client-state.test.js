import {test} from 'node:test';
import assert from 'node:assert/strict';
import {screenKey,acceptSnapshot,canSelect,normalizeCode} from '../public/client-state.js';
const state={code:'ABC234',game:'game-1',phase:'voting',round:0,reveal:-1,revision:3,voted:false,players:[{id:'alex'},{id:'sam'}],used:[],ready:[]};
test('another vote does not replace the screen or selected control',()=>{
 assert.equal(screenKey(state),screenKey({...state,revision:4,ready:['sam']}));
 for(const change of [{round:1},{voted:true},{reveal:0},{game:'game-2'},{phase:'results'}])assert.notEqual(screenKey(state),screenKey({...state,...change}));
});
test('stale and other-lobby responses cannot roll back the current screen',()=>{
 assert.equal(acceptSnapshot(state,{...state,revision:2}),false);
 assert.equal(acceptSnapshot(state,{...state,code:'XYZ234',revision:99}),false);
 assert.equal(acceptSnapshot(state,{...state,revision:4}),true);
 assert.equal(acceptSnapshot(null,state),true);
});
test('selection requires an unused player and an unlocked voting round',()=>{
 assert.equal(canSelect(state,'alex'),true);
 assert.equal(canSelect({...state,used:['alex']},'alex'),false);
 assert.equal(canSelect({...state,voted:true},'alex'),false);
 assert.equal(canSelect({...state,phase:'results'},'alex'),false);
 assert.equal(canSelect(state,'not-a-player'),false);
});
test('pasted invite codes normalize case and whitespace',()=>{
 assert.equal(normalizeCode(' ab c234 \n'),'ABC234');
});
