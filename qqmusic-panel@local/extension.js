/* QQ Music panel controls for GNOME Shell.
 *
 * Adds previous / play-pause / next buttons at the far left of the top bar,
 * driving QQ Music (or the active MPRIS player as a fallback) over D-Bus.
 */

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';
const MPRIS_PATH = '/org/mpris/MediaPlayer2';
const PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';
const QQ_EXE_HINT = 'qqmusic';

const PLAYER_XML = `
<node>
  <interface name="org.mpris.MediaPlayer2.Player">
    <method name="PlayPause"/>
    <method name="Next"/>
    <method name="Previous"/>
    <property name="PlaybackStatus" type="s" access="read"/>
    <property name="CanGoNext" type="b" access="read"/>
    <property name="CanGoPrevious" type="b" access="read"/>
    <property name="CanPlay" type="b" access="read"/>
    <property name="Metadata" type="a{sv}" access="read"/>
  </interface>
</node>`;

const PlayerIfaceInfo = Gio.DBusInterfaceInfo.new_for_xml(PLAYER_XML);

function readLink(path) {
  try {
    return Gio.File.new_for_path(path)
      .query_info('standard::symlink-target',
        Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null)
      .get_symlink_target() ?? '';
  } catch {
    return '';
  }
}

class MprisPlayer {
  constructor(busName, exe, onChange) {
    this.busName = busName;
    this.exe = exe;
    this._onChange = onChange;

    this.proxy = Gio.DBusProxy.new_for_bus_sync(
      Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE, PlayerIfaceInfo,
      busName, MPRIS_PATH, PLAYER_IFACE, null);

    this._propId = this.proxy.connect('g-properties-changed',
      () => this._onChange());
  }

  get status() {
    return this._prop('PlaybackStatus') ?? 'Stopped';
  }

  get canNext() {
    return this._prop('CanGoNext') ?? false;
  }

  get canPrevious() {
    return this._prop('CanGoPrevious') ?? false;
  }

  get title() {
    const metadata = this._prop('Metadata');
    if (!metadata || typeof metadata !== 'object')
      return '';

    let title = metadata['xesam:title'];
    if (title && typeof title.deepUnpack === 'function')
      title = title.deepUnpack();
    else if (title && typeof title.deep_unpack === 'function')
      title = title.deep_unpack();
    return typeof title === 'string' ? title : '';
  }

  _prop(name) {
    const value = this.proxy?.get_cached_property(name);
    return value ? value.deep_unpack() : undefined;
  }

  playPause() {
    this._call('PlayPause');
  }

  next() {
    this._call('Next');
  }

  previous() {
    this._call('Previous');
  }

  _call(method) {
    this.proxy?.call(method, null, Gio.DBusCallFlags.NONE, -1, null,
      (proxy, result) => {
        try {
          proxy.call_finish(result);
        } catch (e) {
          console.warn(`[qqmusic-panel] ${method} failed: ${e.message}`);
        }
      });
  }

  destroy() {
    if (this.proxy && this._propId)
      this.proxy.disconnect(this._propId);
    this._propId = 0;
    this.proxy = null;
  }
}

class PlayerManager {
  constructor(onChange) {
    this._onChange = onChange;
    this._players = new Map();

    this._bus = Gio.DBusProxy.new_for_bus_sync(
      Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE, null,
      'org.freedesktop.DBus', '/org/freedesktop/DBus',
      'org.freedesktop.DBus', null);

    this._nameOwnerId = this._bus.connectSignal('NameOwnerChanged',
      (proxy, sender, params) =>
        this._onNameOwnerChanged(params[0], params[1], params[2]));

    // QQ Music may register its MPRIS name long after the shell starts, and
    // NameOwnerChanged is not always delivered to a proxy. Poll ListNames too.
    this._refresh();
    this._pollId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
      this._refresh();
      return GLib.SOURCE_CONTINUE;
    });
  }

  _refresh() {
    let names;
    try {
      [names] = this._bus.call_sync(
        'ListNames', null, Gio.DBusCallFlags.NONE, -1, null).deep_unpack();
    } catch {
      return;
    }

    const wanted = new Set(names.filter(name => name.startsWith(MPRIS_PREFIX)));

    for (const name of [...this._players.keys()]) {
      if (!wanted.has(name))
        this._remove(name);
    }
    for (const name of wanted)
      this._add(name);

    this._onChange();
  }

  get players() {
    return [...this._players.values()];
  }

  _onNameOwnerChanged(name, oldOwner, newOwner) {
    if (!name.startsWith(MPRIS_PREFIX))
      return;

    if (oldOwner)
      this._remove(name);
    if (newOwner)
      this._add(name);
  }

  _add(name) {
    if (this._players.has(name))
      return;

    try {
      const player = new MprisPlayer(name, this._exeOf(name),
        () => this._onChange());
      this._players.set(name, player);
    } catch (e) {
      console.warn(`[qqmusic-panel] cannot track ${name}: ${e.message}`);
      return;
    }

    this._onChange();
  }

  _remove(name) {
    const player = this._players.get(name);
    if (!player)
      return;

    this._players.delete(name);
    player.destroy();
    this._onChange();
  }

  _exeOf(busName) {
    try {
      const reply = this._bus.call_sync('GetConnectionUnixProcessID',
        new GLib.Variant('(s)', [busName]),
        Gio.DBusCallFlags.NONE, 1000, null);
      const [pid] = reply.deep_unpack();
      return readLink(`/proc/${pid}/exe`);
    } catch {
      return '';
    }
  }

  destroy() {
    if (this._pollId) {
      GLib.source_remove(this._pollId);
      this._pollId = 0;
    }
    if (this._bus && this._nameOwnerId)
      this._bus.disconnectSignal(this._nameOwnerId);
    this._nameOwnerId = 0;

    for (const player of this._players.values())
      player.destroy();
    this._players.clear();
    this._bus = null;
  }
}

const QqIndicator = GObject.registerClass(
class QqIndicator extends PanelMenu.Button {
  _init() {
    super._init(0.0, 'QQ Music controls', true);
    this.add_style_class_name('qqmusic-panel');

    this._player = null;

    this._box = new St.BoxLayout({
      style_class: 'qqmusic-panel-box',
      y_align: Clutter.ActorAlign.CENTER,
    });
    this.add_child(this._box);

    this._previous = this._makeButton('media-skip-backward-symbolic',
      '上一首', () => this._player?.previous());
    this._playPause = this._makeButton('media-playback-start-symbolic',
      '播放/暂停', () => this._player?.playPause());
    this._next = this._makeButton('media-skip-forward-symbolic',
      '下一首', () => this._player?.next());

    this._playPauseIcon = this._playPause.get_child();
    this.visible = true;
  }

  _makeButton(iconName, accessibleName, callback) {
    const button = new St.Button({
      style_class: 'qqmusic-button',
      reactive: true,
      can_focus: true,
      track_hover: true,
      accessible_name: accessibleName,
      child: new St.Icon({
        icon_name: iconName,
        style_class: 'system-status-icon',
      }),
    });
    button.connect('clicked', callback);
    this._box.add_child(button);
    return button;
  }

  setPlayer(player) {
    this._player = player;
    this.visible = true;
    this._sync();
  }

  _setButton(button, enabled) {
    button.reactive = enabled;
    button.can_focus = enabled;
    button.track_hover = enabled;
    button.opacity = enabled ? 255 : 110;
  }

  _sync() {
    const player = this._player;

    if (!player) {
      // Keep the buttons visible but disabled until QQ Music starts playing.
      this._playPauseIcon.icon_name = 'media-playback-start-symbolic';
      this._setButton(this._previous, false);
      this._setButton(this._playPause, false);
      this._setButton(this._next, false);
      this.accessible_name = 'QQ音乐控制（未播放）';
      return;
    }

    const playing = player.status === 'Playing';
    this._playPauseIcon.icon_name = playing
      ? 'media-playback-pause-symbolic'
      : 'media-playback-start-symbolic';

    this._setButton(this._previous, player.canPrevious);
    this._setButton(this._playPause, true);
    this._setButton(this._next, player.canNext);

    const title = player.title;
    this.accessible_name = title ? `QQ音乐：${title}` : 'QQ音乐控制';
  }
});

export default class QqPanelExtension extends Extension {
  enable() {
    this._indicator = new QqIndicator();
    Main.panel.addToStatusArea('qqmusic-panel', this._indicator, 0, 'left');

    this._manager = new PlayerManager(() => this._pickPlayer());
    this._pickPlayer();
  }

  disable() {
    this._manager?.destroy();
    this._manager = null;

    this._indicator?.destroy();
    this._indicator = null;
  }

  _pickPlayer() {
    if (!this._indicator)
      return;

    const players = this._manager?.players ?? [];
    const qqMusic = players.find(player => player.exe.includes(QQ_EXE_HINT));
    const playing = players.find(player => player.status === 'Playing');

    this._indicator.setPlayer(qqMusic ?? playing ?? players[0] ?? null);
  }
}
