/**
 * federation router
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreRouter('api::federation.federation', {
  config: {
    // Federation admin (роль Authenticated + связь federation) может править ТОЛЬКО свою федерацию.
    update: {
      policies: ['api::federation.is-own-federation'],
    },
  },
});
