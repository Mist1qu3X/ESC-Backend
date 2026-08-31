/**
 * category router (core: find/findOne публичные для фронта)
 */
import { factories } from '@strapi/strapi';

// as any на UID: свежий content-type ещё не в сгенерированных типах.
export default factories.createCoreRouter('api::category.category' as any);
