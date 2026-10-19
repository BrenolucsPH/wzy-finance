import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID,randomBytes} from 'node:crypto';
const env={...process.env,AUTH_ENCRYPTION_KEY:randomBytes(32).toString('base64'),WZY_TEST_SCHEMA:'wzy_qa_'+randomUUID().replaceAll('-',''),WZY_QA_PURE_ONLY:'1'};
for(const name of ['verify-migrations.mjs','verify-domain.mjs','verify-interface.mjs','verify-finance.mjs']){const child=spawn(process.execPath,['scripts/'+name],{env,stdio:'inherit',windowsHide:true});const [code]=await once(child,'exit');if(code!==0)throw Error('Pure verification failed: '+name)}
