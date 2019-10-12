import { genModIdAttribute } from './attributes';
import { actions, log, types, selectors } from 'vortex-api';

const SDV_ID = 'stardewvalley';

function init(context: types.IExtensionContext) {
    context.once(() => {
        context.api.addMetaServer('smapi_api', 'https://api.smapi.io/');
        context.registerTableAttribute('mods', genModIdAttribute(context.api));
    });
}


export default init;