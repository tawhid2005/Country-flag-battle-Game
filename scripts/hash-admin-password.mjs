import {hashPassword} from '../server/security.js';
let password='';
for await (const chunk of process.stdin) password+=chunk;
password=password.replace(/\r?\n$/, '');
if(password.length<14 || password.length>128)throw new Error('Use an administrator password of 14–128 characters');
console.log(hashPassword(password));
