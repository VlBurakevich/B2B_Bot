import {bridgeClient} from './bot/protocol.mjs';
const rpc=bridgeClient(process.env.BOT_ORIGIN,process.env.BRIDGE_KEY);
try{const r=await rpc('/bridge/health',{});if(r.ok!==true)throw Error();console.log('Signed bridge health: OK');}
catch{console.error('Bridge check failed. Check HTTPS, key, time synchronization and bot status.');process.exitCode=1;}
