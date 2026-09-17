import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class HexagonLayoutService {

  standardRowDistribution: any = {
    1: [1],
    2: [2],
    7: [2, 3, 2],
    10: [3, 4, 3],
    13: [4, 5, 4],
    19: [3, 4, 5, 4, 3],
    24: [4, 5, 6, 5, 4],
    30: [3, 4, 5, 6, 5, 4, 3],
    34: [2, 3, 4, 5, 6, 5, 4, 3, 2],
    36: [1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1],
    49: [1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1],
    53: [4, 5, 6, 5, 4, 5, 6, 7, 6, 5],
    77: [4, 5, 6, 5, 4, 5, 6, 7, 6, 5, 4, 5, 6, 5, 4],
    84: [3, 4, 5, 6, 5, 4, 3, 4, 5, 6, 5, 4, 3, 4, 5, 6, 5, 4, 3],
    106: [4, 5, 6, 5, 4, 5, 6, 7, 6, 5, 4, 5, 6, 5, 4, 5, 6, 7, 6, 5],
    110: [4, 5, 6, 5, 4, 5, 6, 7, 6, 5, 4, 5, 6, 7, 6, 5, 4, 5, 6, 5, 4],
    183: [
      4, 5, 6, 5, 4,
      5, 6, 7, 6, 5,
      4, 5, 6, 5, 4,
      5, 6, 7, 6, 5,
      4, 5, 6, 5, 4,
      5, 6, 7, 6, 5,
      4, 5, 6, 5, 4,
    ],
    243: [
      3, 4, 5, 6, 5, 4, 3,
      4, 5, 6, 5, 4,
      5, 6, 7, 6, 5,
      4, 5, 6, 5, 4,
      5, 6, 7, 6, 5,
      4, 5, 6, 5, 4,
      5, 6, 7, 6, 5,
      4, 5, 6, 5, 4,
      3, 4, 5, 6, 5, 4, 3,
    ]
  };

  constructor() { }

  calcDimensions(numberOfHex: number, numberOfHives: number, rowDistribution: number[]) {
    const a4width = 840;
    // const a4height = 595;

    let reportDimensions: any = {
      marginX: 0,
      marginY: 0,
      marginMidX: 0,
      marginMidY: 0,
      hexRadius: 0,
      hexWidth: 0,
      hiveHeight: 0,
      hiveWidth: 0,
      marginText: 0
    };
    const totalHexagons = numberOfHives * numberOfHex;

    if (totalHexagons <= 60) {
      reportDimensions.hexRadius = 29; // 1cm 
    } else if (totalHexagons > 60 && totalHexagons <= 114) {
      reportDimensions.hexRadius = 25;
    } else {
      // console.log('Need to split to two pages;');
    }

    if (numberOfHives <= 2) {
      reportDimensions.hexRadius = 40;
    }

    reportDimensions.hexWidth = (Math.floor(reportDimensions.hexRadius * (Math.sqrt(3)) / 2)) * 2;
    reportDimensions.marginMidX = reportDimensions.hexWidth;

    let widthPerHive = reportDimensions?.hexWidth * (Math.max(...rowDistribution));
    let remainingX = a4width - (widthPerHive * 3);

    if (numberOfHives <= 2) {
      remainingX = a4width - (widthPerHive * numberOfHives);
    }
    reportDimensions.hiveWidth = widthPerHive;
    reportDimensions.marginX = (remainingX - (reportDimensions.marginMidX * 2)) / 2;

    if (numberOfHives <= 2) {
      reportDimensions.marginX = (remainingX - (reportDimensions.marginMidX * (numberOfHives - 1))) / 2;
    }

    const numberOfRows = rowDistribution.length;
    let hiveHeight = 0;
    const hexHeight = reportDimensions.hexRadius * 2;
    for (let row = 1; row <= numberOfRows; row++) {
      if (row % 2 !== 0) {
        hiveHeight += hexHeight;
      } else {
        hiveHeight += reportDimensions.hexRadius;
      }
    }
    reportDimensions.hiveHeight = hiveHeight;
    reportDimensions.marginMidY = hexHeight;
    reportDimensions.marginY = hexHeight;

    if (numberOfHives <= 3) {
      reportDimensions.marginY += 60;
    }

    if (reportDimensions.hexRadius === 25) {
      reportDimensions.marginY += 20;
      reportDimensions.marginMidY += 20;
    }

    reportDimensions.marginText = reportDimensions.marginY + (reportDimensions.marginMidY * 1.5) + (reportDimensions.hiveHeight * 2);

    return reportDimensions;
  }

  getRowDistribution(length: number) {
    let rowDistributionArray = Object.keys(this.standardRowDistribution);
    if (rowDistributionArray.includes(length.toString())) {
      return this.standardRowDistribution[length];
    } else {
      for (let index = 0; index < rowDistributionArray.length; index++) {
        if (Number(rowDistributionArray[index]) > length) {
          return this.standardRowDistribution[Number(rowDistributionArray[index])];
        }
      }
    }
    // ✅ FIX: Added return statement
    return undefined;
  }

  initHexStructure(rowDistribution: number[], marginX: number, marginY: number, hexWidth: number, hexRadius: number) {
    let hexStructure: any = {};
    const numberOfRows = rowDistribution.length;
    let testCount = 0;
    for (let row = 1; row <= numberOfRows; row++) {

      hexStructure[`row${row}`] = {};
      let hexgonsInRow = rowDistribution[row - 1];
      let newRow: boolean = true;

      for (let hex = 1; hex <= hexgonsInRow; hex++) {

        testCount += 1;

        hexStructure[`row${row}`][`T${testCount}`] = {};

        for (let point = 65; point <= 70; point++) {
          let pointChar = String.fromCharCode(point);
          hexStructure[`row${row}`][`T${testCount}`][`${pointChar}`] = {};

          if (testCount === 1) {
            switch (pointChar) {
              case 'A': {
                hexStructure[`row${row}`][`T${testCount}`][`${pointChar}`]['x'] = marginX + (hexWidth / 2);
                hexStructure[`row${row}`][`T${testCount}`][`${pointChar}`]['y'] = marginY + (hexRadius / 2);
                break;
              }
              case 'B': {
                hexStructure[`row${row}`][`T${testCount}`][`${pointChar}`]['x'] = marginX + (hexWidth);
                hexStructure[`row${row}`][`T${testCount}`][`${pointChar}`]['y'] = marginY;
                break;
              }
              case 'C': {
                hexStructure[`row${row}`][`T${testCount}`][`${pointChar}`]['x'] = marginX + (hexWidth) + (hexWidth / 2);
                hexStructure[`row${row}`][`T${testCount}`][`${pointChar}`]['y'] = marginY + (hexRadius / 2);
                break;
              }
              case 'D': {
                hexStructure[`row${row}`][`T${testCount}`][`${pointChar}`]['x'] = marginX + (hexWidth) + (hexWidth / 2);
                hexStructure[`row${row}`][`T${testCount}`][`${pointChar}`]['y'] = marginY + (hexRadius * 1.5);
                break;
              }
              case 'E': {
                hexStructure[`row${row}`][`T${testCount}`][`${pointChar}`]['x'] = marginX + (hexWidth);
                hexStructure[`row${row}`][`T${testCount}`][`${pointChar}`]['y'] = marginY + (hexRadius * 2);
                break;
              }
              case 'F': {
                hexStructure[`row${row}`][`T${testCount}`][`${pointChar}`]['x'] = marginX + (hexWidth / 2);
                hexStructure[`row${row}`][`T${testCount}`][`${pointChar}`]['y'] = marginY + (hexRadius * 1.5);
                break;
              }
            }
          } else if (newRow) {
            let hexagonsInPreviousRow = rowDistribution[row - 2];
            if (hexgonsInRow > hexagonsInPreviousRow) {
              let previousRowLeadingTest = testCount - rowDistribution[row - 2];
              switch (pointChar) {
                case 'A': {
                  hexStructure[`row${row}`][`T${testCount}`][`${pointChar}`]['x'] = hexStructure[`row${row - 1}`][`T${previousRowLeadingTest}`][`${pointChar}`]['x'] - (hexWidth / 2);
                  hexStructure[`row${row}`][`T${testCount}`][`${pointChar}`]['y'] = hexStructure[`row${row - 1}`][`T${previousRowLeadingTest}`][`${pointChar}`]['y'] + (hexRadius * 1.5);
                  break;
                }
                case 'B': {
                  hexStructure[`row${row}`][`T${testCount}`][`${pointChar}`]['x'] = hexStructure[`row${row - 1}`][`T${previousRowLeadingTest}`][`${pointChar}`]['x'] - (hexWidth / 2);
                  hexStructure[`row${row}`][`T${testCount}`][`${pointChar}`]['y'] = hexStructure[`row${row - 1}`][`T${previousRowLeadingTest}`][`${pointChar}`]['y'] + (hexRadius * 1.5);
                  break;
                }
                case 'C': {
                  hexStructure[`row${row}`][`T${testCount}`][`${pointChar}`]['x'] = hexStructure[`row${row - 1}`][`T${previousRowLeadingTest}`][`${pointChar}`]['x'] - (hexWidth / 2);
                  hexStructure[`row${row}`][`T${testCount}`][`${pointChar}`]['y'] = hexStructure[`row${row - 1}`][`T${previousRowLeadingTest}`][`${pointChar}`]['y'] + (hexRadius * 1.5);
                  break;
                }
                case 'D': {
                  hexStructure[`row${row}`][`T${testCount}`][`${pointChar}`]['x'] = hexStructure[`row${row - 1}`][`T${previousRowLeadingTest}`][`${pointChar}`]['x'] - (hexWidth / 2);
                  hexStructure[`row${row}`][`T${testCount}`][`${pointChar}`]['y'] = hexStructure[`row${row - 1}`][`T${previousRowLeadingTest}`][`${pointChar}`]['y'] + (hexRadius * 1.5);
                  break;
                }
                case 'E': {
                  hexStructure[`row${row}`][`T${testCount}`][`${pointChar}`]['x'] = hexStructure[`row${row - 1}`][`T${previousRowLeadingTest}`][`${pointChar}`]['x'] - (hexWidth / 2);
                  hexStructure[`row${row}`][`T${testCount}`][`${pointChar}`]['y'] = hexStructure[`row${row - 1}`][`T${previousRowLeadingTest}`][`${pointChar}`]['y'] + (hexRadius * 1.5);
                  break;
                }
                case 'F': {
                  hexStructure[`row${row}`][`T${testCount}`][`${pointChar}`]['x'] = hexStructure[`row${row - 1}`][`T${previousRowLeadingTest}`][`${pointChar}`]['x'] - (hexWidth / 2);
                  hexStructure[`row${row}`][`T${testCount}`][`${pointChar}`]['y'] = hexStructure[`row${row - 1}`][`T${previousRowLeadingTest}`][`${pointChar}`]['y'] + (hexRadius * 1.5);
                  break;
                }
              }
            } else {
              let previousRowLeadingTest = testCount - rowDistribution[row - 2];
              switch (pointChar) {
                case 'A': {
                  hexStructure[`row${row}`][`T${testCount}`][`${pointChar}`]['x'] = hexStructure[`row${row - 1}`][`T${previousRowLeadingTest}`][`${pointChar}`]['x'] + (hexWidth / 2);
                  hexStructure[`row${row}`][`T${testCount}`][`${pointChar}`]['y'] = hexStructure[`row${row - 1}`][`T${previousRowLeadingTest}`][`${pointChar}`]['y'] + (hexRadius * 1.5);
                  break;
                }
                case 'B': {
                  hexStructure[`row${row}`][`T${testCount}`][`${pointChar}`]['x'] = hexStructure[`row${row - 1}`][`T${previousRowLeadingTest}`][`${pointChar}`]['x'] + (hexWidth / 2);
                  hexStructure[`row${row}`][`T${testCount}`][`${pointChar}`]['y'] = hexStructure[`row${row - 1}`][`T${previousRowLeadingTest}`][`${pointChar}`]['y'] + (hexRadius * 1.5);
                  break;
                }
                case 'C': {
                  hexStructure[`row${row}`][`T${testCount}`][`${pointChar}`]['x'] = hexStructure[`row${row - 1}`][`T${previousRowLeadingTest}`][`${pointChar}`]['x'] + (hexWidth / 2);
                  hexStructure[`row${row}`][`T${testCount}`][`${pointChar}`]['y'] = hexStructure[`row${row - 1}`][`T${previousRowLeadingTest}`][`${pointChar}`]['y'] + (hexRadius * 1.5);
                  break;
                }
                case 'D': {
                  hexStructure[`row${row}`][`T${testCount}`][`${pointChar}`]['x'] = hexStructure[`row${row - 1}`][`T${previousRowLeadingTest}`][`${pointChar}`]['x'] + (hexWidth / 2);
                  hexStructure[`row${row}`][`T${testCount}`][`${pointChar}`]['y'] = hexStructure[`row${row - 1}`][`T${previousRowLeadingTest}`][`${pointChar}`]['y'] + (hexRadius * 1.5);
                  break;
                }
                case 'E': {
                  hexStructure[`row${row}`][`T${testCount}`][`${pointChar}`]['x'] = hexStructure[`row${row - 1}`][`T${previousRowLeadingTest}`][`${pointChar}`]['x'] + (hexWidth / 2);
                  hexStructure[`row${row}`][`T${testCount}`][`${pointChar}`]['y'] = hexStructure[`row${row - 1}`][`T${previousRowLeadingTest}`][`${pointChar}`]['y'] + (hexRadius * 1.5);
                  break;
                }
                case 'F': {
                  hexStructure[`row${row}`][`T${testCount}`][`${pointChar}`]['x'] = hexStructure[`row${row - 1}`][`T${previousRowLeadingTest}`][`${pointChar}`]['x'] + (hexWidth / 2);
                  hexStructure[`row${row}`][`T${testCount}`][`${pointChar}`]['y'] = hexStructure[`row${row - 1}`][`T${previousRowLeadingTest}`][`${pointChar}`]['y'] + (hexRadius * 1.5);
                  break;
                }
              }
            }
          } else {
            let pointArr = Object.keys(hexStructure[`row${row}`][`T${testCount}`]);
            pointArr.forEach(hexPoint => {
              hexStructure[`row${row}`][`T${testCount}`][hexPoint]['x'] = hexStructure[`row${row}`][`T${testCount - 1}`][hexPoint]['x'] + hexWidth;
              hexStructure[`row${row}`][`T${testCount}`][hexPoint]['y'] = hexStructure[`row${row}`][`T${testCount - 1}`][hexPoint]['y'];
            });
          }
        }
        newRow = false;
      }
    }
    return hexStructure;
  }

  getHeaderCoordinates(attempt: number, rowDistribution: any, hexStructure: any, reportDimensions: any) {

    const row = 1;
    const lastTestOnRow1 = rowDistribution[0];

    let xcenter = hexStructure[`row${row}`][`T1`]['B']['x'] + (hexStructure[`row${row}`][`T${lastTestOnRow1}`]['B']['x'] - hexStructure[`row${row}`][`T1`]['B']['x']) / 2;
    xcenter = xcenter - reportDimensions.hexWidth / 2;
    let ycenter = hexStructure[`row${row}`][`T1`]['B']['y'] - 20;

    if (attempt < 3) {
      xcenter = xcenter + (reportDimensions.hiveWidth + reportDimensions.marginMidX) * attempt;
    }
    if (attempt >= 3) {
      xcenter = xcenter + (reportDimensions.hiveWidth + reportDimensions.marginMidX) * (attempt - 3);
      ycenter = ycenter + reportDimensions.hiveHeight + reportDimensions.marginMidY;
    }

    return {
      x: xcenter,
      y: ycenter
    };
  }

  getHexPath(hexStructure: any, test: number, row: number, attempt: number, reportDimensions: any) {
    let xDeviation: number = 0;
    let yDeviation: number = 0;

    if (attempt > 0 && attempt < 3) {
      xDeviation = (reportDimensions.hiveWidth + reportDimensions.marginMidX) * attempt;
    }

    if (attempt === 3) {
      xDeviation = 0;
      yDeviation = reportDimensions.hiveHeight + reportDimensions.marginMidY;
    }

    if (attempt > 3) {
      xDeviation = (reportDimensions.hiveWidth + reportDimensions.marginMidX) * (attempt - 3);
      yDeviation = reportDimensions.hiveHeight + reportDimensions.marginMidY;
    }

    const cord = hexStructure[`row${row}`][`T${test}`];

    return `M ${cord['A']['x'] + xDeviation} ${cord['A']['y'] + yDeviation} L ${cord['B']['x'] + xDeviation} ${cord['B']['y'] + yDeviation} L ${cord['C']['x'] + xDeviation} ${cord['C']['y'] + yDeviation} L ${cord['D']['x'] + xDeviation} ${cord['D']['y'] + yDeviation} L ${cord['E']['x'] + xDeviation} ${cord['E']['y'] + yDeviation} L ${cord['F']['x'] + xDeviation} ${cord['F']['y'] + yDeviation} Z`;
  }

  getHexColor(score: number) {
    if (score >= 90.5) {
      return '#00b050';
    }
    if (score >= 80.5 && score < 90.5) {
      return '#92d050';
    }
    if (score >= 60.5 && score < 80.5) {
      return '#fffd87';
    }
    if (score >= 39.5 && score < 60.5) {
      return '#ffc000';
    }
    if (score >= 0 && score < 39.5) {
      return '#ff0000';
    }
    if (score < 0) {
      return '#FFFFFF';
    }
    // ✅ FIX: Added return statement
    return '#FFFFFF';
  }

  getHexCenterX(hexStructure: any, attempt: number, row: number, test: number, reportDimensions: any) {
    let xcenter = hexStructure[`row${row}`][`T${test}`]['A']['x'] + (hexStructure[`row${row}`][`T${test}`]['C']['x'] - hexStructure[`row${row}`][`T${test}`]['A']['x']) / 2;
    if (attempt < 3) {
      xcenter = xcenter + (reportDimensions.hiveWidth + reportDimensions.marginMidX) * attempt;
    }

    if (attempt > 3) {
      xcenter = xcenter + (reportDimensions.hiveWidth + reportDimensions.marginMidX) * (attempt - 3);
    }
    return xcenter;
  }

  getHexCenterY(hexStructure: any, attempt: number, row: number, test: number, reportDimensions: any) {
    let ycenter = hexStructure[`row${row}`][`T${test}`]['B']['y'] + (hexStructure[`row${row}`][`T${test}`]['E']['y'] - hexStructure[`row${row}`][`T${test}`]['B']['y']) / 2;
    if (attempt >= 3) {
      ycenter = ycenter + reportDimensions.hiveHeight + reportDimensions.marginMidY;
    }
    return ycenter;
  }

  calcTableDimensions(attempts: number, numberOfTests: number) {
    const numberOfRows = numberOfTests + 1;
    const a4width = 840;
    const a4height = 595;

    const spaceForAttempts = a4width - (250 + 40 + 100);
    const spacePerAttempt = spaceForAttempts / attempts;

    let spacePerRow = 0;
    if (numberOfRows > 10) {
      spacePerRow = Math.floor((a4height - 100) / numberOfRows);
    } else {
      spacePerRow = 40;
    }

    const tableDimensions: any = {
      'Test': 40,
      'Test Name': 250,
      'Margin': 50,
      'Attempts': spacePerAttempt,
      'row size': spacePerRow,
      'textsize': 11,
      'headersize': 12
    };
    return tableDimensions;
  }
}