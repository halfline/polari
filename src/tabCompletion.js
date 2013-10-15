const Gdk = imports.gi.Gdk;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Pango = imports.gi.Pango;

const Lang = imports.lang;

const TabCompletion = new Lang.Class({
    Name: 'TabCompletion',

    _init: function(entry) {
        this._entry = entry;
        this._canComplete = false;
        this._key = '';

        this._entry.connect('key-press-event', Lang.bind(this, this._onKeyPress));
        this._entry.connect('focus-out-event', Lang.bind(this, this._cancel));
        this._entry.connect('unmap', Lang.bind(this, this._cancel));

        this._popup = new Gtk.Window({ type: Gtk.WindowType.POPUP });

        this._list = new Gtk.ListBox({ selection_mode: Gtk.SelectionMode.SINGLE });
        this._list.set_filter_func(Lang.bind(this, this._filter));
        this._list.connect('row-selected', Lang.bind(this, this._onRowSelected));
        this._list.connect('row-activated', Lang.bind(this, this._stop));
        this._list.connect('keynav-failed', Lang.bind(this, this._onKeynavFailed));
        this._popup.add(this._list);
    },

    _showPopup: function() {
        this._list.show_all();

        let [, height] = this._list.get_preferred_height();
        let [, width] = this._list.get_preferred_width();
        this._popup.resize(width, height);

        let win = this._entry.get_window();

        let layout = this._entry.get_layout();
        let layoutIndex = this._entry.text_index_to_layout_index(this._startPos);
        let wordPos = layout.index_to_pos(layoutIndex);
        let [layoutX,] = this._entry.get_layout_offsets();

        let allocation = this._entry.get_allocation();
        let [ret, x, y] = win.get_origin();
        x += allocation.x + Math.min((layoutX + wordPos.x) / Pango.SCALE,
                                     allocation.width - width);
        y += allocation.y - height;
        this._popup.move(x, y);
        this._popup.show();
    },

    setCompletions: function(completions) {
        if (this._popup.visible) {
            let id = this._popup.connect('unmap', Lang.bind(this,
                function() {
                    this._popup.disconnect(id);
                    this.setCompletions(completions);
                }));
            return;
        }

        this._list.foreach(function(r) { r.destroy(); });

        for (let i = 0; i < completions.length; i++) {
            let row = new Gtk.ListBoxRow();
            row._text = completions[i];
            row._casefoldedText = row._text.toLowerCase();
            row.add(new Gtk.Label({ label: row._text,
                                    halign: Gtk.Align.START,
                                    margin_left: 6,
                                    margin_right: 6 }));
            this._list.add(row);
        }
        this._canComplete = completions.length > 0;
    },

    _onKeyPress: function(w, event) {
        let [, keyval] = event.get_keyval();

        if (this._key.length == 0) {
            if (keyval == Gdk.KEY_Tab) {
                this._start();
                return true;
            }
            return false;
        }

        switch (keyval) {
            case Gdk.KEY_Tab:
            case Gdk.KEY_Down:
                this._moveSelection(Gtk.MovementStep.DISPLAY_LINES, 1);
                return true;
            case Gdk.KEY_ISO_Left_Tab:
            case Gdk.KEY_Up:
                this._moveSelection(Gtk.MovementStep.DISPLAY_LINES, -1);
                return true;
            case Gdk.KEY_Escape:
                this._cancel();
                return true;
        }

        let c = Gdk.keyval_to_unicode(keyval);
        if (c != 0) {
            let str = String.fromCharCode(c);
            if (/[\w|-]/.test(str)) {
                this._key += str;
                this._refilter();

                return true;
            } else {
                let popupShown = this._popup.visible;
                this._stop();
                // eat keys that would active the entry
                // when showing the popup
                return popupShown &&
                       (keyval == Gdk.KEY_Return ||
                        keyval == Gdk.KEY_KP_Enter ||
                        keyval == Gdk.KEY_ISO_Enter);
            }
        }
        return false;
    },

    _getRowCompletion: function(row) {
        if (this._startPos == 0 || this._previousCompletion)
            return row._text + ': ';
        return row._text;
    },

    _onRowSelected: function(w, row) {
        if (row)
            this._insertCompletion(this._getRowCompletion(row));
    },

    _filter: function(row) {
        if (this._key.length == 0)
            return false;
        return row._casefoldedText.startsWith(this._key);
    },

    _insertCompletion: function(completion) {
        let pos = this._entry.get_position();
        this._endPos = this._startPos + completion.length;
        this._entry.delete_text(this._startPos, pos);
        this._entry.insert_text(completion, -1, this._startPos);
        this._entry.set_position(this._endPos);
    },

    _setPreviousCompletionChained: function(chained) {
        let repl = chained ? ',' : ':';
        let start = this._startPos - 2;
        this._entry.delete_text(start, start + 1);
        this._entry.insert_text(repl, -1, start);
    },

    _start: function() {
        if (!this._canComplete)
            return;

        let text = this._entry.text.substr(0, this._entry.get_position());
        this._startPos = text.lastIndexOf(' ') + 1;
        this._key = text.toLowerCase().substr(this._startPos);

        if (this._startPos == 0)
            this._endPos = -1;
        this._previousCompletion = (this._endPos == this._startPos);

        this._refilter();
    },

    _refilter: function() {
        this._list.invalidate_filter();

        let visibleRows = this._list.get_children().filter(function(c) {
            return c.get_child_visible();
        });
        let nVisibleRows = visibleRows.length;

        if (nVisibleRows == 0) {
            this._insertCompletion(this._key);
            this._stop();
            return;
        }

        if (this._previousCompletion)
            this._setPreviousCompletionChained(true);
        this._insertCompletion(this._getRowCompletion(visibleRows[0]));
        if (visibleRows.length > 1) {
            this._list.select_row(visibleRows[0]);
            this._showPopup()
        } else {
            this._popup.hide();
        }
    },

    _onKeynavFailed: function(w, dir) {
        if (this._inHandler)
            return false;
        let count = dir == Gtk.DirectionType.DOWN ? -1 : 1;
        this._inHandler = true;
        this._moveSelection(Gtk.MovementStep.BUFFER_ENDS, count);
        this._inHandler = false;
        return true;
    },

    _moveSelection: function(movement, count) {
        this._list.emit('move-cursor', movement, count);
        let row = this._list.get_focus_child();
        this._list.select_row(row);
    },

    _stop: function() {
        if (this._key.length == 0)
            return;

        this._popup.hide();
        this._popup.set_size_request(-1, -1);

        this._key = '';

        this._list.invalidate_filter();
    },

    _cancel: function() {
        if (this._key.length == 0)
            return;
        if (this._previousCompletion)
            this._setPreviousCompletionChained(false);
        this._insertCompletion('');
        this._stop();
    },
});
