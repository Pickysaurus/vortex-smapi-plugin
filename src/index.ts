import { genModIdAttribute } from './attributes';
import { actions, log, types, util, selectors } from 'vortex-api';
import * as path from 'path';
import * as fs from 'fs-extra-promise';
import * as rjson from 'relaxed-json';
import { addModRule } from 'vortex-api/lib/actions';

const SDV_ID = 'stardewvalley';

function init(context: types.IExtensionContext) {
    context.once(() => {
        context.api.addMetaServer('smapi_api', 'https://api.smapi.io/');
        context.registerTableAttribute('mods', genModIdAttribute(context.api));
        util.installIconSet('smapi-chicken', `${__dirname}/pufferchick.svg`);
        context.registerAction('mods-action-icons', 300, 'pufferchick', {}, 'Update SMAPI Data',
                         instanceIds => {
                             checkforSMAPIdetails(instanceIds, selectors.activeGameId(context.api.store.getState()), context.api.store) 
                            }, 
                            instanceIds => selectors.activeGameId(context.api.store.getState()) === SDV_ID);
        context.registerAction('mods-multirow-actions', 300, 'pufferchick', {}, 'Update SMAPI Data',
                         instanceIds => {
                             checkforSMAPIdetails(instanceIds, selectors.activeGameId(context.api.store.getState()), context.api.store) 
                            }, 
                            instanceIds => selectors.activeGameId(context.api.store.getState()) === SDV_ID);
    });
}

export async function checkforSMAPIdetails(modIds: string[], activeGameId : string, store: any) {
    //TODO: Ignore disabled mods in content pack and dependency checking.
    //TODO: Stop duplicate rules - seems to be coming from the content pack setup for mods with multiple manifests.   
    //Get our staging folder and mods
    const stagingPath = selectors.installPathForGame(store.getState(), activeGameId);
    const mods = util.getSafe(store.getState(), ['persistent', 'mods', activeGameId], undefined);
    modIds = modIds.filter((m) => mods[m]);
    modIds.forEach(async (modId) => {
        log('debug',`checkforSMAPIdetails: `+modId+' '+activeGameId);
        const mod = mods[modId];
        const modRules = mod.rules;
        //TEMP FIX
        store.dispatch(actions.clearModRules(activeGameId, modId));
        //END TEMP FIX
        const modKeys = Object.keys(mods).filter((k) => k != modId); //Remove our current mod from this array.
        const modPath = path.join(stagingPath, modId);
        try {
            //Get the root of the mod folder.
            const modFolders = await fs.readdirAsync(modPath);
            //Handle the manifest(s)
            const smapiModInfo = await modFolders.map((modFolder : string) => {
                const manifest = fs.readFileSync(path.join(modPath, modFolder, 'manifest.json'), 'utf8');
                const parsedManifest = rjson.parse(util.deBOM(manifest));
                //If this is missing it's useless.
                if (parsedManifest['UniqueID']) {
                    //Update contact pack data in the manifest
                    const cp =  parsedManifest['ContentPackFor'];
                    cp.modLoaded = [];
                    const cpId = cp ? cp['UniqueID'] : undefined;
                    const cpMinVer = cp ? cp['MinimumVersion'] : undefined;
                    //Remove an old rule for missing file, if one exists.
                    //const oldRule = modRules.find((r) => r.fileExpression === cpId);
                    //if (oldRule) store.dispatch(actions.removeModRule(activeGameId, modId, oldRule));

                    //Attempt to match the content pack to another loaded mod. 
                    const contentPackData =  cp ? modKeys.forEach((key) => {
                        //Get the mod from it's key
                        const checkMod = mods[key];
                        const match = (checkMod.attributes.smapiModInfo) ? (checkMod.attributes.smapiModInfo).find((cp) => cp.id === cpId) 
                        : undefined;
                        if (match) {
                            const matchModId = checkMod.id;
                            const matchLogicalName = checkMod.attributes.logicalFileName || undefined;
                            cp.modLoaded.push(matchLogicalName || matchModId);
                            const rule = {
                                type: 'requires',
                                reference: matchLogicalName ? {logicalFileName: matchLogicalName, version: cpMinVer ? `${cpMinVer}^` : '*' } : {fileExpression: matchModId, version: cpMinVer ? `${cpMinVer}^` : '*'}
                            };
                            store.dispatch(actions.addModRule(activeGameId, modId, rule));
                        };

                    }) 
                    : null;
                    if (cp.modLoaded.length === 0) {
                        const rule = {type: 'requires', reference: {fileExpression: cpId, version: cpMinVer || '*'}};
                        store.dispatch(actions.addModRule(activeGameId, modId, rule));
                    };

                    //Update dependency data in the manifest
                    const dependencyData = parsedManifest['Dependencies'] ? parsedManifest['Dependencies'].forEach((dependency) => {
                        const depId = dependency['UniqueID'];
                        const depReq = dependency['IsRequired'];
                        dependency.modLoaded = [];
                        //Remove an old rule for missing file (if one exists);
                        //const oldRule = modRules.find((r) => r.fileExpression === depId);
                        //if (oldRule) store.dispatch(actions.removeModRule(activeGameId, modId, oldRule));

                        //Iterate through the loaded mods to find a match.
                        modKeys.forEach((key) => {
                            //Get the mod from it's key
                            const checkMod = mods[key];
                            //Try and find a match.
                            const match = (checkMod.attributes.smapiModInfo) ? (checkMod.attributes.smapiModInfo.find((dep) => dep.id === depId)) : undefined;
                            if (match && dependency.modLoaded.length === 0) {
                                //Found one!
                                const matchModId = checkMod.id;
                                const matchModLogicalName = checkMod.attributes.logicalFileName;
                                //Push into the dependancy object.
                                dependency.modLoaded.push(matchModLogicalName || matchModId);
                                //Create a rule.
                                const rule = {
                                    type: depReq ? 'requires' : 'after',
                                    reference: matchModLogicalName ? {logicalFileName : matchModLogicalName, version: '*'} : {fileExpression: matchModId, version: '*'}
                                };
                                store.dispatch(actions.addModRule(activeGameId, modId, rule));
                            }

                        });
                        if (dependency.modLoaded.length === 0) {
                            const rule = {type: depReq ? 'requires' : 'after', reference: {fileExpression: depId, version: '*'}};
                            store.dispatch(actions.addModRule(activeGameId, modId, rule));
                        }
                        return parsedManifest['Dependencies'];

                    }) 
                    : null;

                    return {
                        id: parsedManifest['UniqueID'],
                        contentPackFor: cp,
                        dependencies: parsedManifest['Dependencies']
                    };
                }
                else console.log('warn', 'Invalid manifest in '+modFolder);
            });
            //Save SMAPI mod info. 
            store.dispatch(actions.setModAttribute(activeGameId, modId, 'smapiModInfo', smapiModInfo));
        }
        catch(err) {
            log('warn', err);
        }
    });
}

export default init;