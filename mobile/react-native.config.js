module.exports = {
  dependencies: {
    'expo-notifications': {
      platforms: {
        ios: null, // Disable autolinking on iOS — personal dev team can't provision Push Notifications
      },
    },
  },
};
