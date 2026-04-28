import React, { useState } from 'react';

export const SettingsModal = ({ isOpen, onClose, userSettings, onSaveSettings }) => {
  const [settings, setSettings] = useState(userSettings || {
    autoScroll: true,
    fontSize: 'medium',
    notifications: true,
    darkMode: false,
    voiceEnabled: true,
    soundVolume: 70,
  });

  const handleSettingChange = (key, value) => {
    setSettings((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleSave = () => {
    onSaveSettings?.(settings);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="settings-modal__backdrop" onClick={onClose} />

      {/* Modal */}
      <div className="settings-modal">
        <div className="settings-modal__header">
          <h2>Settings</h2>
          <button
            className="settings-modal__close"
            onClick={onClose}
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        <div className="settings-modal__content">
          {/* Auto Scroll Setting */}
          <div className="settings-modal__section">
            <label className="settings-modal__label">
              <input
                type="checkbox"
                checked={settings.autoScroll}
                onChange={(e) => handleSettingChange('autoScroll', e.target.checked)}
                className="settings-modal__checkbox"
              />
              <span>Auto Scroll to Latest Message</span>
            </label>
          </div>

          {/* Font Size Setting */}
          <div className="settings-modal__section">
            <label className="settings-modal__label-text">Font Size</label>
            <select
              value={settings.fontSize}
              onChange={(e) => handleSettingChange('fontSize', e.target.value)}
              className="settings-modal__select"
            >
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
              <option value="extra-large">Extra Large</option>
            </select>
          </div>

          {/* Notifications Setting */}
          <div className="settings-modal__section">
            <label className="settings-modal__label">
              <input
                type="checkbox"
                checked={settings.notifications}
                onChange={(e) => handleSettingChange('notifications', e.target.checked)}
                className="settings-modal__checkbox"
              />
              <span>Enable Notifications</span>
            </label>
          </div>

          {/* Dark Mode Setting */}
          <div className="settings-modal__section">
            <label className="settings-modal__label">
              <input
                type="checkbox"
                checked={settings.darkMode}
                onChange={(e) => handleSettingChange('darkMode', e.target.checked)}
                className="settings-modal__checkbox"
              />
              <span>Dark Mode</span>
            </label>
          </div>

          {/* Voice Enabled Setting */}
          <div className="settings-modal__section">
            <label className="settings-modal__label">
              <input
                type="checkbox"
                checked={settings.voiceEnabled}
                onChange={(e) => handleSettingChange('voiceEnabled', e.target.checked)}
                className="settings-modal__checkbox"
              />
              <span>Voice Input</span>
            </label>
          </div>

          {/* Sound Volume Setting */}
          <div className="settings-modal__section">
            <label className="settings-modal__label-text">Sound Volume</label>
            <div className="settings-modal__slider-container">
              <input
                type="range"
                min="0"
                max="100"
                value={settings.soundVolume}
                onChange={(e) => handleSettingChange('soundVolume', parseInt(e.target.value))}
                className="settings-modal__slider"
              />
              <span className="settings-modal__slider-value">{settings.soundVolume}%</span>
            </div>
          </div>
        </div>

        <div className="settings-modal__footer">
          <button
            className="settings-modal__button settings-modal__button--secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="settings-modal__button settings-modal__button--primary"
            onClick={handleSave}
          >
            Save Settings
          </button>
        </div>
      </div>
    </>
  );
};
