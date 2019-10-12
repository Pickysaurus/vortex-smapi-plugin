import { actions, ComponentEx, FormFeedback, FormInput, log, types, selectors, util } from 'vortex-api';

import * as I18next from 'i18next';
import * as React from 'react';
import { Button, ControlLabel, FormGroup, InputGroup, ListGroup, ListGroupItem } from 'react-bootstrap';
import * as Redux from 'redux';
import * as https from 'https';
import * as fs from 'fs-extra-promise';
import * as path from 'path';
import * as rjson from 'relaxed-json';


export interface IProps {
  activeGameId: string;
  fileGameId: string;
  modId: string;
  nexusModsId?: string;
  readOnly?: boolean;
  isDownload: boolean;
  smapiModInfo?: object[];
  fileName: string;
  t: I18next.TFunction;
  store: Redux.Store<any>;
}

/**
 * SMAPI Mod Id Detail
 *
 * @class SMAPIModIdDetail
 */
class SMAPIModIdDetail extends ComponentEx<IProps, {}> {
  public render(): JSX.Element {
    const { activeGameId, t, fileName, modId, smapiModInfo, readOnly } = this.props;
    const isIdValid = (!!smapiModInfo) && (smapiModInfo !== undefined);
    //Render either the list or "No data" message.
    return (
      <div>
        {isIdValid ? 
            <ListGroup>

            {smapiModInfo.map(this.renderSMAPIInfo)}

            </ListGroup>
            : <p style={{ color: 'var(--text-color-disabled)' }}>{t('No SMAPI data.')}</p>
        }
        <InputGroup.Button style={{ width: 'initial' }}>
        <Button onClick={this.checkforSMAPIdetails}>{t('Update SMAPI Info')}</Button>
        </InputGroup.Button>
      </div>
    );
  }

  private renderSMAPIInfo = (smapiMod): JSX.Element => {
      //Build the list items for the SMAPI mods we've found.
      //TODO: Work out why the colours aren't working as expected.
      //TODO: Add colour coding for the contentPackFor.
      const { activeGameId, store, t } = this.props;
      return (
          <ListGroupItem style={{padding:'5px 15px', background:'var(--gray-lighter)', borderBottom:'1px solid var(--gray-darker)', marginBottom:'2px'}}>
              <p style={{margin:0}}><b>{t('Unique ID: ')}</b></p>
              <p style={{margin:'2px 0'}}><i>{smapiMod.id}</i></p>
              { !!smapiMod.contentPackFor ? <div>
                <p style={{margin:0}}><b>{t('Content Pack for: ')}</b></p>
                <p style={{margin:'2px 0', color: smapiMod.contentPackFor.modLoaded && smapiMod.contentPackFor.modLoaded.length > 0 ? 'var(--brand-success)' : 'var(--brand-danger)'}}><i>{`${smapiMod.contentPackFor.UniqueID} ${smapiMod.contentPackFor.MinimumVersion ? `(${smapiMod.contentPackFor.MinimumVersion}+)`: ''}`}</i></p>
                </div> : null }
              { !!smapiMod.dependancies ? <div>
                <p style={{margin:0}}><b>{t('Dependancies: ')}</b></p>
                <i style={{margin:'2px 0'}}>{smapiMod.dependancies.map(mod => <p style={{margin:0, color: mod.modLoaded.length > 0 ? 'var(--brand-success)' : mod.IsRequired ? 'var(--brand-danger)' : 'var(--text-color-disabled)'}}>{mod.UniqueID}</p>)}</i>
                </div> : null }
          </ListGroupItem>
      )
  }

  private checkforSMAPIdetails = async () => {
      //We're going to get the SMAPI compatability data from the manifest.
      //TODO: Run this on ContentPackFor as well as dependancies.
      //TODO: Ignore disabled mods. 
      const { activeGameId, modId, isDownload, smapiModInfo, nexusModsId, store } = this.props; 
      const stagingPath = selectors.installPathForGame(store.getState(), activeGameId);
      const mods = util.getSafe(store.getState(), ['persistent', 'mods', activeGameId], undefined);
      const modPath = path.join(stagingPath, modId);
      try {
        //Reset all rules for this mod. In SDV rules are not likely to be used for anything as file conflicts are very rare. 
        await store.dispatch(actions.clearModRules(activeGameId, modId));
        //Get the staging folder.
        const modFolders = await fs.readdirAsync(modPath);
        //Handle to manifest
        const smapiModInfo = await modFolders.map((modFolder : string) => {
            const manifest = fs.readFileSync(path.join(modPath, modFolder, 'manifest.json'), 'utf8');
            const parsedManifest = rjson.parse(util.deBOM(manifest));
            //If the manifest is missing UniqueID it's useless to us. 
            if (parsedManifest['UniqueID'] !== undefined) {
                //Get information about the dependancies to supplient to the manifest info. 
                const dependancyData = parsedManifest['Dependencies'] ? parsedManifest['Dependencies'].forEach((dependancy) => {
                    const dependID = dependancy['UniqueID'];
                    dependancy.modLoaded = [];
                    //Filter mods so we exclude the current mod. 
                    Object.keys(mods).filter((k) => k != modId).forEach((key) => {
                        //Get the mod back from it's key.
                        const mod = mods[key];
                        //Does the mod have the correct info?
                        const match = (mod.attributes.smapiModInfo) ? (mod.attributes.smapiModInfo.find((dep) => dep.id === dependID)) : undefined;
                        if (match)  {
                            //We have a match!
                            const matchModId = mod.id;
                            const modLogicalName = mod.attributes.logicalFileName || undefined;
                            //Push the mod name or ID to the dependancy object.
                            dependancy.modLoaded.push(modLogicalName || matchModId);
                            //Create a mod rule. Requires is used for hard requirements, after is used for soft requirements.
                            const rule = {
                                type: dependancy.IsRequired ? 'requires' : 'after',
                                reference: modLogicalName ? {logicalFileName: modLogicalName, version: '*'} : {fileExpression: matchModId, version: '*'}
                            }
                            //Apply the rule.
                            store.dispatch(actions.addModRule(activeGameId, modId, rule));
                        }
                    })
                    if (dependancy.modLoaded.length === 0) {
                        //If we did not find the UniqueID, set a dependancy to inform the user of a missing file, again using requires only for hard requirements. 
                        const rule = {type: dependancy.IsRequired ? 'requires' : 'after', reference: {fileExpression: dependID, version: '*'}};
                        store.dispatch(actions.addModRule(activeGameId, modId, rule));
                    }
                    return parsedManifest['Dependencies'];
                }) : null;
                //TODO: Add in contentPackFor processing - these are always required and can specify a min version. 
                const contentPackData = parsedManifest['ContentPackFor'] ?  Object.keys(mods).filter((k) => k != modId).forEach((key) => {
                    //Get the mod back from it's key.
                    const mod = mods[key];
                    const cp = parsedManifest['ContentPackFor'];
                    cp.modLoaded = []
                    const cpMinVer = parsedManifest['MinimumVersion'];
                    const cpId = cp['UniqueID'];
                    //Does the mod have the correct info?
                    const match = (mod.attributes.smapiModInfo) ? (mod.attributes.smapiModInfo.find((dep) => dep.id === cpId)) : undefined;
                    if (match) {
                        const matchModId = mod.id;
                        const matchLogicalName = mod.attributes.logicalFileName || undefined;
                        cp.modLoaded.push(matchLogicalName || matchModId);
                        const rule = {
                            type: 'requires',
                            reference: matchLogicalName ? {logicalFileName: matchLogicalName, version: cpMinVer ? `${cpMinVer}^` : '*' } : {fileExpression: matchModId, version: '*'}
                        };
                        store.dispatch(actions.addModRule(activeGameId, modId, rule));
                    };
                })
                : null
                //Build the smapiModInfo object now.
                return {
                id: parsedManifest['UniqueID'],
                contentPackFor: parsedManifest['ContentPackFor'] || null,
                dependancies: parsedManifest['Dependencies']
                };
            }
        });

        //Save the SMAPI mod information. 
        store.dispatch(actions.setModAttribute(activeGameId, modId, 'smapiModInfo', smapiModInfo));
      }
      catch(err) {
          log("warn", err);
      }
      
      return 
  };
}

function smapiModRequest(body) {
    try {
        const options = {
            hostname: 'api.smapi.io',
            port: 443,
            path: '/v2.11.3/mods',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': body.length
            }
        };

        let request = https.request(options, (res) => {
            const { statusCode } = res;
            const contentType = res.headers['content-type'];

            let err : string;
            if (statusCode !== 200) {
                err = `Request Failed. Status Code: ${statusCode}`;
            } else if (!/^application\/json/.test(contentType)) {
                err = `Invalid content-type ${contentType}`;
            }

            if (err !== undefined) {
                return new Error(err);
            }

            res.setEncoding('utf8');
            let response = '';
            res.on('data', function(d) { response += d; } );
            res.on('end', () => {
                try {
                    console.log(response);
                    return (response); 
                }
                catch (err) {
                    return (new Error(err));
                }
            });
        })
        .on('error', (err: Error) => {
            return err;
        });
        
        request.write(body);
        request.end();

    }
    catch (err) {
        console.log(err);
        return (new Error(err));
    };
}

export default SMAPIModIdDetail;


/*
Rule Object
[
    {
        reference: {logicalFileName: "attr.logicalFileName", versionMatch: "^1.0.0 or *"}.
        type: "requires"
    },
    {
        reference: {fileExpression: "id", versionMatch: "^1.0.0 or *"}.
        type: "requires"
    }
]
import {addModRule} from './actions/mods';
store.dispatch(actions.addModRule(installGameId, modId, rule));

//These worked!
const rule = {reference: {fileExpression: "Mods", versionMatch: "*"}, type:'requires'}
store.dispatch(actions.addModRule(activeGameId, modId, rule));
*/