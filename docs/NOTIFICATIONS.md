# Notifications

Browser notification permission is opt-in. The app does not request permission on page load.

The current frontend supports local notification controls; durable Web Push requires a deployment with a push subscription store and VAPID keys. Do not add provider secrets to the browser bundle.

When Web Push is added, notifications should be limited to meaningful state changes: new severe warnings, significant escalation, or a user-selected threshold. Repeated unchanged forecasts should not generate repeated notifications.
