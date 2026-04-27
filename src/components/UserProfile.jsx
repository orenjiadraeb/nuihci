import React, { useState } from 'react';
import { ProfilePictureUpload } from './ProfilePictureUpload';
import { SettingsModal } from './SettingsModal';

export const UserProfile = ({ user, onLogout, onProfileUpdate }) => {
  const [showSettings, setShowSettings] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [displayName, setDisplayName] = useState(user?.displayName || 'User');

  const handleProfilePictureUpdate = (photoURL) => {
    onProfileUpdate?.({
      ...user,
      photoURL,
    });
  };

  const handleNameSave = () => {
    onProfileUpdate?.({
      ...user,
      displayName,
    });
    setEditingName(false);
  };

  const handleSaveSettings = (settings) => {
    // Save settings to localStorage or database
    localStorage.setItem('userSettings', JSON.stringify(settings));
    console.log('Settings saved:', settings);
  };

  return (
    <div className="user-profile">
      {/* Profile Header */}
      <div className="user-profile__header">
        <div className="user-profile__avatar-container">
          <img
            src={user?.photoURL || 'https://via.placeholder.com/100'}
            alt="Profile"
            className="user-profile__avatar"
          />
        </div>

        <div className="user-profile__info">
          <div className="user-profile__name-section">
            {editingName ? (
              <div className="user-profile__name-edit">
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="user-profile__name-input"
                  autoFocus
                />
                <button
                  onClick={handleNameSave}
                  className="user-profile__save-button"
                >
                  Save
                </button>
              </div>
            ) : (
              <h2
                className="user-profile__name"
                onClick={() => setEditingName(true)}
              >
                {displayName}
                <span className="user-profile__edit-icon">✎</span>
              </h2>
            )}
          </div>

          <p className="user-profile__email">{user?.email || 'No email'}</p>

          <div className="user-profile__actions">
            <ProfilePictureUpload
              userId={user?.uid}
              onUploadSuccess={handleProfilePictureUpdate}
            />

            <button
              className="user-profile__settings-button"
              onClick={() => setShowSettings(true)}
            >
              ⚙️ Settings
            </button>

            <button
              className="user-profile__logout-button"
              onClick={onLogout}
            >
              Log Out
            </button>
          </div>
        </div>
      </div>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        onSaveSettings={handleSaveSettings}
      />
    </div>
  );
};
