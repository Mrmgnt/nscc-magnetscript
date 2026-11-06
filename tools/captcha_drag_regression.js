#!/usr/bin/env node
'use strict';
const path = require('path');
const solver = require('../lib/ns_captcha_solver.js');
(async () => {
 const root = path.join(__dirname, '..', 'logs', 'captcha_fail');
 const bg = await solver.loadImageRGBA(path.join(root, 'verify_rejected_1793956240299_background.png'));
 const pc = await solver.loadImageRGBA(path.join(root, 'verify_rejected_1793956240299_piece.png'));
 const got = solver.detectSpeckledShape(bg.rgba, pc.rgba, {bgW:bg.width,bgH:bg.height,pcW:pc.width,pcH:pc.height,xMin:0,xMax:bg.width-pc.width,yRange:[0,bg.height-pc.height]});
 const pass = Math.abs(got.x-135)<=3 && Math.abs(got.y-59)<=3;
 console.log((pass?'PASS':'FAIL')+' drag_shape 1793956240299 expected~135,59 got='+got.x+','+got.y);
 process.exit(pass?0:1);
})().catch(e=>{console.error(e.message);process.exit(1)});