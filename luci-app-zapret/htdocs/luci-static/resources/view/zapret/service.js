'use strict';
'require fs';
'require poll';
'require uci';
'require ui';
'require view';
'require view.zapret.tools as tools';

const btn_style_neutral  = 'btn';
const btn_style_action   = 'btn cbi-button-action';
const btn_style_positive = 'btn cbi-button-save important';
const btn_style_negative = 'btn cbi-button-reset important';
const btn_style_warning  = 'btn cbi-button-negative';
const btn_style_success  = 'btn cbi-button-success important';

return view.extend({
    get_svc_buttons: function(elems = { }) {
        return {
            enable  : elems.btn_enable  || document.getElementById('btn_enable'),
            disable : elems.btn_disable || document.getElementById('btn_disable'),
            start   : elems.btn_start   || document.getElementById('btn_start'),
            restart : elems.btn_restart || document.getElementById('btn_restart'),
            stop    : elems.btn_stop    || document.getElementById('btn_stop'),
            update  : elems.btn_update  || document.getElementById('btn_update'),
            reset   : elems.btn_update  || document.getElementById('btn_reset'),
        };
    },
    
    disableButtons: function(flag, button, elems = { }) {
        let btn = this.get_svc_buttons(elems);
        btn.enable.disabled  = flag;
        btn.disable.disabled = flag;
        btn.start.disabled   = flag;
        btn.restart.disabled = flag;
        btn.stop.disabled    = flag;
        btn.update.disabled  = true; // TODO
        btn.reset.disabled   = false;
    },

    getAppStatus: function() {
        return Promise.all([
            tools.getInitState(tools.appName),    // svc_state
            fs.exec(tools.execPath, [ 'info' ]),  // svc_info
            fs.exec('/bin/ps'),                   // process list
            fs.exec('/bin/opkg', [ 'list-installed', '*zapret*' ]),  // installed packages
            uci.load(tools.appName),              // config
        ]).catch(e => {
            ui.addNotification(null, E('p', _('Unable to execute or read contents')
                + ': %s [ %s | %s | %s ]'.format(
                    e.message, tools.execPath, 'tools.getInitState', 'uci.zapret'
            )));
        });
    },

    setAppStatus: function(status_array, elems = { }, force_app_status = 0) {
        let cfg = uci.get(tools.appName, 'config');
        if (!status_array || cfg == null || typeof(cfg) !== 'object') {
            let elem_status = elems.status || document.getElementById("status");
            elem_status.innerHTML = tools.makeStatusString(null);
            ui.addNotification(null, E('p', _('Unable to read the contents') + ': setAppStatus()'));
            this.disableButtons(true, null, elems);
            return;
        }
        let svc_autorun = status_array[0] ? true : false;
        let svc_info = status_array[1];   // stdout: JSON as text
        let proc_list = status_array[2];  // stdout: multiline text
        let pkg_list = status_array[3];   // stdout: installed packages
        if (svc_info.code != 0) {
            ui.addNotification(null, E('p', _('Unable to read the service info, please try ResetSettings') + ': setAppStatus()'));
            this.disableButtons(true, null, elems);
            return;
        }
        if (proc_list.code != 0) {
            ui.addNotification(null, E('p', _('Unable to read process list') + ': setAppStatus()'));
            this.disableButtons(true, null, elems);
            return;
        }
        if (pkg_list.code != 0) {
            ui.addNotification(null, E('p', _('Unable to enumerate installed packages') + ': setAppStatus()'));
            this.disableButtons(true, null, elems);
            return;
        }
        let svcinfo;
        if (force_app_status) {
            svcinfo = force_app_status;
        } else {
            svcinfo = tools.decode_svc_info(svc_autorun, svc_info, proc_list, cfg);
        }
        let btn = this.get_svc_buttons(elems);
        btn.update.disabled = true;   // TODO
        btn.reset.disabled = false;

        if (Number.isInteger(svcinfo)) {
            ui.addNotification(null, E('p', _('Error')
                + ' %s: return code = %s'.format('decode_svc_info', svcinfo + ' ')));
            this.disableButtons(true, null, elems);
        } else {
            btn.enable.disabled  = (svc_autorun) ? true : false;
            btn.disable.disabled = (svc_autorun) ? false : true;
            if (!svcinfo.dmn.inited) {
                btn.start.disabled = false;
                btn.restart.disabled = true;
                btn.stop.disabled = true;
            } else {
                btn.start.disabled = true;
                btn.restart.disabled = false;
                btn.stop.disabled = false;
            }
        }
        let elem_status = elems.status || document.getElementById("status");
        elem_status.innerHTML = tools.makeStatusString(svcinfo, cfg.FWTYPE, 'user_only');
        
        if (!poll.active()) {
            poll.start();
        }
    },

    serviceAction: function(action, button) {
        if (button) {
            let elem = document.getElementById(button);
            this.disableButtons(true, elem);
        }
        poll.stop();
        
        let _this = this;
        
        return tools.handleServiceAction(tools.appName, action)
        .then(() => {
            return _this.getAppStatus().then(
                (status_array) => {
                    _this.setAppStatus(status_array);
                }
            );
        })
        .catch(e => { 
            ui.addNotification(null, E('p', _('Unable to run service action.') + ' Error: ' + e.message));
        });
    },

    serviceActionEx: function(action, button, hide_modal = false) {
        if (button) {
            let elem = document.getElementById(button);
            this.disableButtons(true, elem);
        }
        poll.stop();
        
        let _this = this;
        let exec_cmd = null;
        let exec_arg = [ ];
        let errmsg = 'ERROR:';
        if (action == 'start' || action == 'restart') {
            exec_cmd = tools.syncCfgPath;
            errmsg = _('Unable to run sync_config.sh script.');
        }
        else if (action == 'reset') {
            exec_cmd = tools.defaultCfgPath;
            exec_arg = [ '-fs' ];
            errmsg = _('Unable to run uci-def-cfg.sh script.');
            action = null;
        } else {
            ui.addNotification(null, E('p', 'ERROR: unknown action'));
            return null;
        }
        return fs.exec(exec_cmd, exec_arg)
        .then(function(res) { 
            if (res.code != 0) {
                ui.addNotification(null, E('p', errmsg + ' res.code = ' + res.code));
                action = null;  // return with error
            }
            if (hide_modal) {
                ui.hideModal();
            }
            if (!action) {
                return _this.getAppStatus().then(
                    (status_array) => {
                        _this.setAppStatus(status_array);
                    }
                );
            }
            return _this.serviceAction(action, null);
        })
        .catch(e => { 
            ui.addNotification(null, E('p', errmsg + ' Error: ' + e.message));
        });
    },

    appAction: function(action, button) {
        if (button) {
            let elem = document.getElementById(button);
            this.disableButtons(true, elem);
        }

        poll.stop();

        if (action === 'update') {
            this.getAppStatus().then(
                (status_array) => {
                    this.setAppStatus(status_array, [], 4);
                }
            );
        }

        return fs.exec_direct(tools.execPath, [ action ]).then(res => {
            return this.getAppStatus().then(
                (status_array) => {
                    this.setAppStatus(status_array);
                    ui.hideModal();
                }
            );
        });
    },

    statusPoll: function() {
        this.getAppStatus().then(
            L.bind(this.setAppStatus, this)
        );
    },

    dialogResetCfg: function(ev) {
        ev.target.blur();
        let cancel_button = E('button', {
            'class': btn_style_neutral,
            'click': ui.hideModal,
        }, _('Cancel'));

        let resetcfg_btn = E('button', {
            'class': btn_style_action,
        }, _('Reset settings'));
        resetcfg_btn.onclick = ui.createHandlerFn(this, () => {
            cancel_button.disabled = true;
            return this.serviceActionEx('reset', resetcfg_btn, true);
        });

        ui.showModal(_('Reset settings to default'), [
            E('div', { 'class': 'cbi-section' }, [
                E('p', _('All settings will be reset to default. Continue?')),
            ]),
            E('div', { 'class': 'right' }, [
                cancel_button,
                ' ',
                resetcfg_btn,
            ])
        ]);
    },

    load: function() {
        return this.getAppStatus();
    },

    render: function(status_array) {
        if (!status_array) {
            return;
        }
        let cfg = uci.get(tools.appName, 'config');

        let pkg_list = status_array[3];
        if (pkg_list === undefined || typeof(pkg_list) !== 'object' || pkg_list.code != 0) {
            ui.addNotification(null, E('p', _('Unable to enumerate installed packages') + ': setAppStatus()'));
            return;
        }

        let status_string = E('div', {
            'id'   : 'status',
            'name' : 'status',
            'class': 'cbi-section-node',
        });

        let layout = E('div', { 'class': 'cbi-section-node' });

        function layout_append(title, descr, elems) {
            descr = (descr) ? E('div', { 'class': 'cbi-value-description' }, descr) : '';
            let elist = elems;
            let elem_list = [ ];
            for (let i = 0; i < elist.length; i++) {
                elem_list.push(elist[i]);
                elem_list.push(' ');
            }
            let vlist = [ E('div', {}, elem_list ) ];
            for (let i = 0; i < elist.length; i++) {
                let input = E('input', {
                    'id'  : elist[i].id + '_hidden',
                    'type': 'hidden',
                });
                vlist.push(input);
            }
            let elem_name = (elist.length == 1) ? elist[0].id + '_hidden' : null;
            layout.append(
                E('div', { 'class': 'cbi-value' }, [
                    E('label', { 'class': 'cbi-value-title', 'for': elem_name }, title),
                    E('div', { 'class': 'cbi-value-field' }, vlist),
                ])
            );
        }

        let create_btn = function(name, _class, locname) {
            return E('button', {
                'id'   : name,
                'name' : name,
                'class': _class,
            }, locname);
        };
        
        let btn_enable      = create_btn('btn_enable',  btn_style_success, _('Enable'));
        btn_enable.onclick  = ui.createHandlerFn(this, this.serviceAction, 'enable', 'btn_enable');
        let btn_disable     = create_btn('btn_disable', btn_style_warning, _('Disable'));
        btn_disable.onclick = ui.createHandlerFn(this, this.serviceAction, 'disable', 'btn_disable');
        layout_append(_('Service autorun control'), null, [ btn_enable, btn_disable ] );

        let btn_start       = create_btn('btn_start',   btn_style_action, _('Start'));
        btn_start.onclick   = ui.createHandlerFn(this, this.serviceActionEx, 'start', 'btn_start');
        let btn_restart     = create_btn('btn_restart', btn_style_action, _('Restart'));
        btn_restart.onclick = ui.createHandlerFn(this, this.serviceActionEx, 'restart', 'btn_restart');
        let btn_stop        = create_btn('btn_stop',    btn_style_warning, _('Stop'));
        btn_stop.onclick    = ui.createHandlerFn(this, this.serviceAction, 'stop', 'btn_stop');
        layout_append(_('Service daemons control'), null, [ btn_start, btn_restart, btn_stop ] );

        let btn_update      = create_btn('btn_update',  btn_style_action, _('Update'));
        btn_update.onclick  = ui.createHandlerFn(this, () => { this.appAction('update', 'btn_update') });
        layout_append(_('Update blacklist'), null, [ btn_update ] );
        
        let btn_reset       = create_btn('btn_reset', btn_style_action, _('Reset settings'));
        btn_reset.onclick   = L.bind(this.dialogResetCfg, this);
        layout_append(_('Reset settings to default'), null, [ btn_reset ] );

        let elems = {
            "status": status_string,
            "btn_enable": btn_enable,
            "btn_disable": btn_disable,
            "btn_start": btn_start,
            "btn_restart": btn_restart,
            "btn_stop": btn_stop,
            "btn_update": btn_update,
            "btn_reset": btn_reset,
        };
        this.setAppStatus(status_array, elems);

        poll.add(L.bind(this.statusPoll, this));

        let page_title = _('Zapret');
        let pkgdict = tools.decode_pkg_list(pkg_list.stdout);
        page_title += ' &nbsp ';
        if (pkgdict['zapret'] === undefined || pkgdict['zapret'] == '') {
            page_title += 'unknown version';
        } else {
            page_title += 'v' + pkgdict['zapret'];
        }
        let aux1 = E('em');
        let aux2 = E('em');
        if (pkgdict['zapret'] != pkgdict['luci-app-zapret']) {
            let errtxt = 'LuCI APP v' + pkgdict['luci-app-zapret'] + ' [ incorrect version! ]';
            aux1 = E('div', { 'class': 'label-status error' }, errtxt);
            aux2 = E('div', { }, '&nbsp');
        }
        
        let url1 = 'https://github.com/bol-van/zapret';
        let url2 = 'https://github.com/remittor/zapret-openwrt';

        return E([
            E('h2', { 'class': 'fade-in' }, page_title),
            aux1,
            aux2,
            E('div', { 'class': 'cbi-section-descr fade-in' },
                E('a', { 'href': url1, 'target': '_blank' }, url1),
            ),
            E('div', { 'class': 'cbi-section-descr fade-in' },
                E('a', { 'href': url2, 'target': '_blank' }, url2),
            ),
            E('div', { 'class': 'cbi-section fade-in' }, [
                status_string,
            ]),
            E('div', { 'class': 'cbi-section fade-in' },
                layout
            ),
        ]);
    },

    handleSave     : null,
    handleSaveApply: null,
    handleReset    : null,
});
