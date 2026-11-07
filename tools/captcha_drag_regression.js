#!/usr/bin/env node
'use strict';
const path = require('path');
const solver = require('../lib/ns_captcha_solver.js');
(async () => {
 const root = path.join(__dirname, '..', 'logs', 'captcha_fail');
 const cases = [['1793956240299',136,60],['1793973126549',101,51],['1793974400180',182,43]];
 let failed = false;
 for (const [id, expectedX, expectedY] of cases) {
  const bg = await solver.loadImageRGBA(path.join(root, 'verify_rejected_'+id+'_background.png'));
  const pc = await solver.loadImageRGBA(path.join(root, 'verify_rejected_'+id+'_piece.png'));
  const got = solver.detectSpeckledShape(bg.rgba, pc.rgba, {bgW:bg.width,bgH:bg.height,pcW:pc.width,pcH:pc.height,xMin:0,xMax:bg.width-pc.width,yRange:[0,bg.height-pc.height]});
  const pass = Math.abs(got.x-expectedX)<=3 && Math.abs(got.y-expectedY)<=3;
  failed ||= !pass;
  console.log((pass?'PASS':'FAIL')+' drag_shape '+id+' expected~'+expectedX+','+expectedY+' got='+got.x+','+got.y);
 }
 process.exit(failed?1:0);
})().catch(e=>{console.error(e.message);process.exit(1)});
