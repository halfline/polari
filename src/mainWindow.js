const Gdk = imports.gi.Gdk;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Tp = imports.gi.TelepathyGLib;

const AccountsMonitor = imports.accountsMonitor;
const AppNotifications = imports.appNotifications;
const ChatroomManager = imports.chatroomManager;
const ChatView = imports.chatView;
const IrcParser = imports.ircParser;
const InitialSetupWindow = imports.initialSetupWindow;
const JoinDialog = imports.joinDialog;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const RoomList = imports.roomList;
const UserList = imports.userList;

const MAX_NICK_UPDATE_TIME = 5; /* s */
const CONFIGURE_TIMEOUT = 100; /* ms */


const MainWindow = new Lang.Class({
    Name: 'MainWindow',

    _init: function(app) {
        let builder = new Gtk.Builder();
        builder.add_from_resource('/org/gnome/polari/main-window.ui');

        this.window = builder.get_object('main_window');
        this.window.application = app;

        let overlay = builder.get_object('overlay');

        overlay.add_overlay(app.notificationQueue.widget);
        overlay.add_overlay(app.commandOutputQueue.widget);

        this._ircParser = new IrcParser.IrcParser();

        this._accountsMonitor = new AccountsMonitor.getDefault();
        this._accountsMonitor.connect('account-status-changed',
                                      Lang.bind(this, this._onAccountChanged));
        this._accountsMonitor.connect('account-added',
                                      Lang.bind(this, this._onAccountChanged));

        this._roomManager = new ChatroomManager.getDefault();
        this._roomManager.connect('room-added',
                                  Lang.bind(this, this._roomAdded));
        this._roomManager.connect('room-removed',
                                  Lang.bind(this, this._roomRemoved));
        this._roomManager.connect('active-changed',
                                  Lang.bind(this, this._activeRoomChanged));

        this._rooms = {};

        this._room = null;
        this._settings = new Gio.Settings({ schema: 'org.gnome.polari' });

        this._displayNameChangedId = 0;
        this._topicChangedId = 0;
        this._nicknameChangedId = 0;
        this._configureId = 0;

        this._titlebarRight = builder.get_object('titlebar_right');
        this._titlebarLeft = builder.get_object('titlebar_left');

        this._selectionRevealer = builder.get_object('selection_toolbar_revealer');
        this._revealer = builder.get_object('room_list_revealer');
        this._chatStack = builder.get_object('chat_stack');
        this._inputArea = builder.get_object('main_input_area');
        this._nickEntry = builder.get_object('nick_entry');
        this._entry = builder.get_object('message_entry');

        this._nickEntry.width_chars = ChatView.MAX_NICK_CHARS

        let scroll = builder.get_object('room_list_scrollview');
        this._roomList = new RoomList.RoomList();
        scroll.add(this._roomList.widget);

        this._userListStack = builder.get_object('user_list_stack');

        let revealer = builder.get_object('user_list_revealer');
        app.connect('action-state-changed::user-list', Lang.bind(this,
            function(group, actionName, value) {
                revealer.reveal_child = value.get_boolean();
            }));

        this._selectionModeAction = app.lookup_action('selection-mode');
        this._selectionModeAction.connect('notify::state',
                    Lang.bind(this, this._onSelectionModeChanged));

        this._entry.connect('activate', Lang.bind(this,
            function() {
                this._ircParser.process(this._entry.text);
                this._entry.text = '';
            }));

        this._nickEntry.connect('activate', Lang.bind(this,
            function() {
               if (this._nickEntry.text)
                   this._setNick(this._nickEntry.text);
               this._entry.grab_focus();
            }));
        this._nickEntry.connect('focus-out-event', Lang.bind(this,
             function() {
               this._nickEntry.text = '';
            }));
        this._nickEntry.connect_after('key-press-event', Lang.bind(this,
            function(w, event) {
                let [, keyval] = event.get_keyval();
                if (keyval == Gdk.KEY_Escape) {
                    this._entry.grab_focus();
                    return true;
                }
                return false;
            }));
        this.window.connect_after('key-press-event', Lang.bind(this,
            function(w, event) {
                let [, keyval] = event.get_keyval();
                if (keyval == Gdk.KEY_Escape) {
                    this._selectionModeAction.change_state(GLib.Variant.new('b', false));
                }
            }));
        this.window.connect('window-state-event',
                            Lang.bind(this, this._onWindowStateEvent));
        this.window.connect('configure-event',
                            Lang.bind(this, this._onConfigureEvent));
        this.window.connect('delete-event',
                            Lang.bind(this, this._onDelete));

        let size = this._settings.get_value('window-size');
        if (size.n_children() == 2) {
            let width = size.get_child_value(0);
            let height = size.get_child_value(1);
            this.window.set_default_size(width.get_int32(), height.get_int32());
        }

        let position = this._settings.get_value('window-position');
        if (position.n_children() == 2) {
            let x = position.get_child_value(0);
            let y = position.get_child_value(1);
            this.window.move(x.get_int32(), y.get_int32());
        }

        if (this._settings.get_boolean('window-maximized'))
            this.window.maximize();

        this._updateSensitivity();

        this.window.show_all();

        //if(this._accountsMonitor.dupAccounts().length == 0) {
            let initialSetupWindow = new InitialSetupWindow.InitialSetupWindow();
        //}
    },

    _onWindowStateEvent: function(widget, event) {
        let window = widget.get_window();
        let state = window.get_state();

        if (state & Gdk.WindowState.FULLSCREEN)
            return;

        let maximized = (state & Gdk.WindowState.MAXIMIZED);
        this._settings.set_boolean('window-maximized', maximized);
    },

    _saveGeometry: function() {
        let window = this.window.get_window();
        let state = window.get_state();

        if (state & Gdk.WindowState.MAXIMIZED)
            return;

        let size = this.window.get_size();
        this._settings.set_value('window-size', GLib.Variant.new('ai', size));

        let position = this.window.get_position();
        this._settings.set_value('window-position',
                                 GLib.Variant.new('ai', position));
    },

    _onConfigureEvent: function(widget, event) {
        let window = widget.get_window();
        let state = window.get_state();

        if (state & Gdk.WindowState.FULLSCREEN)
            return;

        if (this._configureId != 0) {
            Mainloop.source_remove(this._configureId);
            this._configureId = 0;
        }

        this._configureId = Mainloop.timeout_add(CONFIGURE_TIMEOUT,
            Lang.bind(this, function() {
                this._saveGeometry();
                return false;
            }));
    },

    _onDelete: function(widget, event) {
        if (this._configureId != 0) {
            Mainloop.source_remove(this._configureId);
            this._configureId = 0;
        }

        this._saveGeometry();
    },

    _onSelectionModeChanged: function() {
        let enabled = this._selectionModeAction.state.get_boolean();
        this._selectionRevealer.reveal_child = enabled;

        if (enabled) {
            this._titlebarLeft.get_style_context().add_class('selection-mode');
            this._titlebarRight.get_style_context().add_class('selection-mode');
        } else {
            this._titlebarLeft.get_style_context().remove_class('selection-mode');
            this._titlebarRight.get_style_context().remove_class('selection-mode');
        }
    },

    _onAccountChanged: function(am, account) {
        if (account.connection_status != Tp.ConnectionStatus.CONNECTING)
            return;

        if (account._connectingNotification)
            return;

        let app = Gio.Application.get_default();
        let notification = new AppNotifications.ConnectingNotification(account);
        app.notificationQueue.addNotification(notification);

        account._connectingNotification = notification;
        notification.widget.connect('destroy',
            function() {
		delete account._connectingNotification;
            });
    },


    _roomAdded: function(roomManager, room) {
        let userList;
        let chatView = new ChatView.ChatView(room);

        if (room.channel.handle_type == Tp.HandleType.ROOM)
            userList = new UserList.UserList(room);
        else
            userList = { widget: new Gtk.Label() };

        this._rooms[room.id] = [chatView, userList];

        this._userListStack.add_named(userList.widget, room.id);
        this._chatStack.add_named(chatView.widget, room.id);

        this._revealer.reveal_child = roomManager.roomCount > 0;
    },

    _roomRemoved: function(roomManager, room) {
        this._rooms[room.id].forEach(function(w) { w.widget.destroy(); });
        delete this._rooms[room.id];

        this._revealer.reveal_child = roomManager.roomCount > 0;
    },

    _activeRoomChanged: function(manager, room) {
        if (this._room) {
            this._room.disconnect(this._displayNameChangedId);
            this._room.disconnect(this._topicChangedId);
            this._room.channel.connection.disconnect(this._nicknameChangedId);
        }
        this._displayNameChangedId = 0;
        this._topicChangedId = 0;
        this._nicknameChangedId = 0;

        this._room = room;

        this._updateTitlebar();
        this._updateNick();
        this._updateSensitivity();

        if (!this._room)
            return; // finished

        this._displayNameChangedId =
            this._room.connect('notify::display-name',
                               Lang.bind(this, this._updateTitlebar));
        this._topicChangedId =
            this._room.connect('notify::topic',
                               Lang.bind(this, this._updateTitlebar));
        this._nicknameChangedId =
            this._room.channel.connection.connect('notify::self-contact',
                                                  Lang.bind(this,
                                                            this._updateNick));

        this._chatStack.set_visible_child_name(this._room.id);
        this._userListStack.set_visible_child_name(this._room.id);
    },

    _setNick: function(nick) {
        this._nickEntry.placeholder_text = nick;

        let account = this._room.channel.connection.get_account();
        account.set_nickname_async(nick, Lang.bind(this,
            function(a, res) {
                try {
                    log("testing");
                    log(a);
                    log(res);
                    log("End testing");
                    let value = a.set_nickname_finish(res);
                    log(value);
                } catch(e) {
                    logError(e, "Failed to change nick");

                    this._updateNick();
                    return;
                }

                // TpAccount:nickname is a local property which doesn't
                // necessarily match the externally visible nick; telepathy
                // doesn't consider failing to sync the two an error, so
                // we give the server MAX_NICK_UPDATE_TIME seconds until
                // we assume failure and revert back to the server nick
                //
                // (set_aliases() would do what we want, but it's not
                // introspected)
                Mainloop.timeout_add_seconds(MAX_NICK_UPDATE_TIME,
                    Lang.bind(this, function() {
                        this._updateNick();
                        return false;
                    }));
            }));
    },

    showJoinRoomDialog: function() {
        let dialog = new JoinDialog.JoinDialog();
        dialog.widget.transient_for = this.window;
        dialog.widget.show();
        dialog.widget.connect('response',
            function(widget) {
                widget.destroy();
            });
    },

    _updateTitlebar: function() {
        this._titlebarRight.title = this._room ? this._room.display_name : null;
        this._titlebarRight.subtitle = this._room ? this._room.topic : null;
    },

    _updateNick: function() {
        let nick = this._room ? this._room.channel.connection.self_contact.alias
                              : '';
        this._nickEntry.placeholder_text = nick;
    },

    _updateSensitivity: function() {
        this._inputArea.sensitive = this._room != null;

        if (!this._inputArea.sensitive)
            return;

        this._entry.grab_focus();
    }
});
