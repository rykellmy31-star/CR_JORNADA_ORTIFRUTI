import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {HORTIFRUTI_ADMIN_URL,HORTIFRUTI_SUPERADMIN_URL} from '../src/shared/store-domain';

describe('identidade CR Jornada Express',()=>{
 it('usa a nova marca na apresentação, login, administração e metadados',()=>{
  const page=readFileSync('index.html','utf8');
  const app=readFileSync('src/web/App.tsx','utf8');
  expect(page).toContain('<title>CR Jornada Express');
  expect(page).toContain('favicon-express.svg');
  expect(app).toContain('CR Jornada <b>Express</b>');
  expect(app).toContain('Super Admin do Express');
  expect(app).toContain('Seu comércio online, simples e rápido!');
  expect(app).not.toContain('CR Jornada Hortifruti');
  expect(app).not.toContain('Super Admin do Hortifruti');
 });
 it('mantém os domínios legados para não quebrar acesso de lojistas',()=>{
  expect(HORTIFRUTI_ADMIN_URL).toBe('https://hortifruti.crjornada.com/admin');
  expect(HORTIFRUTI_SUPERADMIN_URL).toBe('https://hortifruti-admin.crjornada.com');
 });
});
