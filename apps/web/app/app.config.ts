export default defineAppConfig({
  ui: {
    colors: {
      primary: 'emerald',
      neutral: 'slate',
    },
    toaster: {
      slots: {
        // Lift bottom-anchored toasts above the Android gesture bar (env() is 0
        // on web/desktop; margin-bottom is inert for top-anchored positions).
        viewport: 'mb-[env(safe-area-inset-bottom,0px)]',
      },
    },
  },
});
