import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import {Table, Null} from 'apache-arrow';
import * as parser from 'fast-xml-parser';
import { parseHex } from './src/sbe19plusV2/parseHex';
import { convertToEngineeringUnits } from './src/sbe19plusV2/convertResults';
import { getTrawlSurveyHaulData, getHexFiles, getXmlconFiles, saveToFile } from './src/utilities';
import { logger } from './src/logger';
import * as moment from 'moment';

logger.info('***** Start data processing.... *****');
// process.exit(0);
// setInterval(function(){ process.exit(0); }, 100);

// Sample Data
const dir = "./data/sbe19plusV2/";
const hexFileName = "PORT_CTD5048_DO1360CT1460Op302_Hauls_1to5_21May2016.hex";
const xmlconFileName = "SBE19plusV2_5048.xmlcon";

const dataDir = path.join(os.homedir(), "Desktop", "CTD");  // Change to the real dir for processing
const outputDir = path.join(os.homedir(), "Desktop", "CTD output");
if (!existsSync(outputDir)) {
    mkdirSync(outputDir);
}

let currentOutputDir: string = null;
let start: moment.Moment = null, end: moment.Moment = null, duration: number = null,
    hex_file_start: moment.Moment = null;
let df: Table = null, results: Object = null;
let currentHex: string = null, currentXmlcon: string = null, 
    currentYear: string = null, currentVessel: string = null,
    currentPosition: string = null, currentCTD: string = null;
let strippedArray: string[] = null, lineArray: string[] = null, 
    hexFileArray: string[] = null;
let metrics: number[] = [];

async function bulkProcess() {

    // Retrieve the Trawl Survey Haul Data
    logger.info(`Retrieving haul data`)
    start = moment();
    const hauls = await getTrawlSurveyHaulData();
    end = moment();
    duration = moment.duration(end.diff(start)).asSeconds();
    logger.info(`\tProcessing time - retrieving haul data: ${duration}s`);

    // Find all of the hex files
    logger.info(`Searching for hex files: ${dataDir}`);
    start = moment();
    let hexFilesArray = await getHexFiles(dataDir);
    writeFileSync(path.join(os.homedir(), "Desktop", "hexFiles.txt"),
        hexFilesArray.join("\n")
    );
    logger.info(`\thex file count: ${hexFilesArray.length}`);
    end = moment();
    duration = moment.duration(end.diff(start)).asSeconds();
    logger.info(`\tProcessing time - getting hex files: ${duration}s`);

    // Find all of the xmlcon files
    logger.info(`Searching for xmlcon files: ${dataDir}`);
    start = moment();
    let xmlconFilesArray = await getXmlconFiles(dataDir);
    writeFileSync(path.join(os.homedir(), "Desktop", "xmlconList.txt"),
        xmlconFilesArray.join("\n")
    );
    logger.info(`\txmlcon file count: ${xmlconFilesArray.length}`);
    end = moment();
    duration = moment.duration(end.diff(start)).asSeconds();
    logger.info(`\tProcessing time - getting xmlcon files: ${duration}s`);

    // Prepare hex file list for parsing
    strippedArray = hexFilesArray.map(x => {
        return x.replace(dataDir.replace(/\\/g, '\/') + "/", "");
    });

    // TESTING ONLY
    strippedArray = strippedArray.slice(0, 3);

    let idx: number = 0, outputFile: string = null;
    // Must use for ... of syntax for proper ordering, per:  
    //     https://lavrton.com/javascript-loops-how-to-handle-async-await-6252dd3c795/
    for (const x of strippedArray) {

        // if (idx < 295) {
        //     idx += 1;
        //     continue;
        // }
        // if (idx === 300) break;

        hex_file_start = moment();

        lineArray = x.split("/");
        hexFileArray = lineArray.slice(-1)[0].split("_");

        currentYear = lineArray[0];
        currentVessel = lineArray[1]; 
        currentPosition = hexFileArray[0];
        currentCTD = hexFileArray[1].replace("CTD", "");

        // Only process 2017 data - Process everyting but the 2017 CTD7738 system
        // if (  (currentYear === "2016") ||  
        //     ((currentYear === "2017") && (currentCTD === "7738"))
        //     ) {
        //     idx += 1;
        //     continue;
        // }

        // Create the output directory if it does not exist + outputFile string
        if (!existsSync(path.join(outputDir, currentYear)))
            mkdirSync(path.join(outputDir, currentYear));
        if (!existsSync(path.join(outputDir, currentYear, currentVessel)))
            mkdirSync(path.join(outputDir, currentYear, currentVessel));
        currentOutputDir = path.join(outputDir, currentYear, currentVessel);
        outputFile = path.join(currentOutputDir, lineArray.slice(-1)[0].slice(0, -3) + "csv");

        console.info("\n");
        logger.info(`**************************************************`);
        logger.info(`*** Processing item ${idx}: ${currentYear}, ${currentVessel}, ` +
            `${currentPosition}, ${currentCTD} ***`);
        logger.info(`**************************************************`);

        currentHex = path.resolve(path.join(dataDir, strippedArray[idx]));
        currentXmlcon = path.resolve(path.join(dataDir, currentYear, 
            currentYear + "_CTD_ConFiles_Raw", "SBE19plusV2_" + currentCTD + ".xmlcon"))
            
        logger.info(`\txmlcon: ${currentXmlcon}`);
        logger.info(`\tinputHex = ${currentHex}`);
        logger.info(`\toutputCSV = ${outputFile}`);

        // TESTING ONLY
        // idx += 1;
        // continue;

        // Read an individiaul xmlcon file
        let xmlconFileInMemory = readFileSync(currentXmlcon, "utf8");

        // Retrieve the xmlcon instrument and sensor details as JSON
        let xmlconJson = parser.parse(xmlconFileInMemory);
        let instrument = xmlconJson.SBE_InstrumentConfiguration.Instrument;
        let sensors = instrument.SensorArray.Sensor;

        // Parse hex file and convert to raw, decimal values in arrow data structure
        if (instrument.Name.indexOf("SBE 19plus V2") > -1) {
    
            // results = await parseHex(currentHex, instrument, sensors, outputFile, hauls, currentVessel);
            logger.info(`\tParsing Hex File`);
            start = moment();        
            results = await parseHex(currentHex);
            end = moment();
            duration = moment.duration(end.diff(start)).asSeconds();
            logger.info(`\t\tProcessing time - parsing hex file: ${duration}s`);

            logger.info(`\tConverting to Engineering Units`);
            start = moment();        
            df = await convertToEngineeringUnits(instrument, sensors, results["casts"], 
                results["voltageOffsets"], results["pumpDelay"], results["df"], 
                outputFile, hauls, currentVessel);
            end = moment();
            duration = moment.duration(end.diff(start)).asSeconds();
            logger.info(`\t\tProcessing time - converting to engineering units: ${duration}s`);

            // Save the results to a csv file
            logger.info(`\tSaving data to a csv file`);
            start = moment();
            let outputColumns = ["Temperature (degC)", "Pressure (dbars)", "Conductivity (S_per_m)",
                "Salinity (psu)", "Oxygen (ml_per_l)", "OPTODE Oxygen (ml_per_l)", "Depth (m)",
                "Latitude (decDeg)", "Longitude (decDeg)", "HaulID", "DateTime (ISO8601)", "Year", "Month", "Day"
            ];
            await saveToFile(df, "csv", outputFile, outputColumns);
            end = moment();
            duration = moment.duration(end.diff(start)).asSeconds();
            logger.info(`\t\tProcessing time - saving result to a file: ${duration}s`);

            // Display the results
            // let sliceSize: number = 5, 
            //     sliceStart: number = 0, //df.length - sliceSize, 
            //     sliceEnd: number = sliceStart + sliceSize;
            // try {
                // outputColumns.forEach(x => {
                //     results = df.getColumn(x).toArray().slice(sliceStart, sliceEnd);
                //     console.info(`\t${x}: ${results}`);
                // });
                // console.info(`Schema: ${df.schema.fields.map(x => x.name)}`);
                // console.info(`Voltage Offsets: ${JSON.stringify(voltageOffsets)}`);
                // console.info(`Casts: ${JSON.stringify(casts)}`);
            // } catch (e) {
            //     logger.error(`Error printing results: ${e}`);
            // }
        }
        end = moment();
        duration = moment.duration(end.diff(hex_file_start)).asSeconds();
        logger.info(`\tProcessing time - item ${idx} - overall file processing: ${duration}s`);
        metrics.push(duration);

        idx += 1;
    }
    let totalTime = metrics.reduce((x, y) => x + y, 0);
    logger.info('Total Processing time');
    logger.info(`\t${idx} items, total time: ${totalTime.toFixed(1)}s, ` +
        `time per item = ${(totalTime/idx).toFixed(1)}s`);

    // ToDo - Auto QA/QC the new arrow data structure

    // ToDo - Persist the data to disk

}

bulkProcess();