import SMAPIModIdDetail from './views/SMAPIModIdDetail';
import { log, types, selectors, util } from 'vortex-api';
import * as I18next from 'i18next';
import * as Redux from 'redux';
import * as React from 'react';


export function genModIdAttribute(api: types.IExtensionApi): types.ITableAttribute {
    return {
        id: 'smapiid',
        name: 'SMAPI Information',
        description: 'Compatibility information supplied by the SMAPI API.',
        icon: 'external-link',
        customRenderer: (mod, detail, t) => {
            //Make sure this is a SDV mod and it isn't a sdvrootfolder, dinput or enb mod. 
            //console.log(mod);
            const res =  util.getSafe(mod.attributes, ['downloadGame'], undefined) === 'stardewvalley' && util.getSafe(mod, ['type'], undefined) === ''
            ? renderSMAPIModIdDetail(api.store, mod, t)
            : null;
            return res;
        },
        calc: (mod) => 
        util.getSafe(mod.attributes, ['downloadGame'], undefined) === 'stardewvalley'
        ? util.getSafe(mod.attributes, ['modId'], null)
        : undefined
        ,
        placement: 'detail',
        isToggleable: false,
        edit: {},
        isSortable: false,
        isVolatile: true
    }
};

function renderSMAPIModIdDetail(
    store: Redux.Store<any>,
    mod: types.IMod, //IModWithState(?)
    t: I18next.TFunction) {
        const smapiModInfo: object = util.getSafe(mod.attributes, ['smapiModInfo'], undefined);
        const nexusModsId: string = util.getSafe(mod.attributes, ['modId'], undefined);
        const fileName: string = 
        util.getSafe(mod.attributes, ['filename'],
            util.getSafe(mod.attributes, ['name'], undefined));
        const gameMode = selectors.activeGameId(store.getState());
        const fileGameId = util.getSafe(mod.attributes, ['downloadGame'], undefined)
                || gameMode;
        return (
            <SMAPIModIdDetail
            modId={mod.id}
            nexusModsId={nexusModsId}
            smapiModInfo={smapiModInfo}
            activeGameId={gameMode}
            fileGameId={fileGameId}
            fileName={fileName}
            isDownload={mod.state === 'downloaded'}
            t={t}
            store={store}
            />
        );
    }