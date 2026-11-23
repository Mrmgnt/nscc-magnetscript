#!/usr/bin/env node
/** cc: MagnetScript(Razki) */
/**
 * ns_event.js — Wrapper kompatibilitas ke ns_thanksgiving.js
 */
'use strict';

const thanksgiving = require('./ns_thanksgiving.js');

if (require.main === module) {
    thanksgiving.main()
        .then(() => {
            if (typeof thanksgiving.releaseTerminalInput === 'function') thanksgiving.releaseTerminalInput();
            process.exit(0);
        })
        .catch(error => {
            console.error('FATAL ' + error.message);
            if (typeof thanksgiving.releaseTerminalInput === 'function') thanksgiving.releaseTerminalInput();
            process.exit(1);
        });
}

module.exports = thanksgiving;

