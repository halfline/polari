const Gtk = imports.gi.Gtk;
const Tp = imports.gi.TelepathyGLib;

const Connections = imports.connections;
const Lang = imports.lang;
const Signals = imports.signals;

const InitialSetupWindow = new Lang.Class({
    Name: 'InitialSetupWindow',

    _init: function() {
    	let builder = new Gtk.Builder();
        builder.add_from_resource('/org/gnome/polari/initial-setup.ui');

        this.window = builder.get_object('initial_setup');

		let connectionList = builder.get_object('connectionList');
		let addConnectionRow = builder.get_object('addConnectionRow');
        connectionList.connect('row-activated', Lang.bind(this, this._addConnection));
        this.window.show_all();
    },

    _addConnection: function() {
    	log("connection activated");
    	let dialog = new Connections.ConnectionsDialog();
        dialog.widget.show();
        dialog.widget.connect('response',
            function(widget) {
                widget.destroy();
            });
    }
});