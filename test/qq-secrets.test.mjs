import test from 'node:test';
import assert from 'node:assert/strict';
import {protectQQSecret,unprotectQQSecret} from '../src/qq-secrets.mjs';

test('Windows DPAPI stores current-user ciphertext and preserves UTF8 without printing the secret',{skip:process.platform!=='win32'},async()=>{
  const value='synthetic-密钥-🔐';const encrypted=await protectQQSecret(value);
  assert.notEqual(encrypted,value);assert.match(encrypted,/^[A-Za-z0-9+/=]+$/);assert.equal(await unprotectQQSecret(encrypted),value);
  await assert.rejects(unprotectQQSecret('invalid-ciphertext'),e=>e.code==='secret_store_unavailable'&&!e.message.includes(value));
});
