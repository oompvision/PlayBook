/**
 * Custom Expo config plugin wrapper for @stripe/stripe-react-native.
 *
 * The Stripe package's app.plugin.js exports the full CommonJS module object,
 * which can cause Expo's plugin resolver to fail to pass props through correctly.
 * This wrapper directly imports the plugin function and invokes it with the
 * required configuration.
 */
const { createRunOncePlugin } = require('@expo/config-plugins');

function withStripeConfig(config) {
  // Require the Stripe plugin module and extract the actual plugin function
  const stripeMod = require('@stripe/stripe-react-native/lib/commonjs/plugin/withStripe');
  const withStripe = stripeMod.default || stripeMod.withStripe || stripeMod;

  // Call it with the required props
  return withStripe(config, {
    merchantIdentifier: 'merchant.app.ezbooker',
    enableGooglePay: true,
  });
}

module.exports = createRunOncePlugin(withStripeConfig, 'withStripeConfig');
