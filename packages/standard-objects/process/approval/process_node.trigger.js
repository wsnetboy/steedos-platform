const _ = require("underscore");
const objectql = require('@steedos/objectql');
const util = require('./util');

const reviseRecordOrder = async function (processId, record) {
    let processNodes = await objectql.getObject("process_node").find({ filters: ['process_definition', '=', processId], sort: 'order asc' });
    if (record) {
        const recordOrder = record.order;
        const recordId = record._id;
        const afterNodes = _.filter(processNodes, function (node) {
            if (node._id != recordId && node.order >= recordOrder) {
                return true;
            }
            return false;
        })
        let _afterIndex = recordOrder + 1;
        for (const processNode of afterNodes) {
            await objectql.getObject("process_node").directUpdate(processNode._id, { order: _afterIndex });
            _afterIndex++;
        }
        processNodes = await objectql.getObject("process_node").find({ filters: ['process_definition', '=', processId], sort: 'order asc' });
    }
    let _index = 1;
    for (const processNode of processNodes) {
        if (processNode.order != _index) {
            await objectql.getObject("process_node").directUpdate(processNode._id, { order: _index });
        }
        _index++;
    }

    const processNodeFirst = await objectql.getObject("process_node").find({ filters: [['process_definition', '=', processId], ['order', '=', 1]] });
    for (const processNode of processNodeFirst) {
        if (processNode.reject_behavior != 'reject_request') {
            await objectql.getObject("process_node").directUpdate(processNode._id, { reject_behavior: 'reject_request' });
        }
    }
}

const allowChange = async function(processId){
    if(processId){
        var process = await objectql.getObject("process_definition").findOne(processId);
        if(process){
            if(process.active){
                return false;    
            }else{
                var processInstancesCount = await objectql.getObject('process_instance').count({filters: ['process_definition', '=', processId]});
                if(processInstancesCount > 0){
                    return false;
                }
            }
            return true
        }else{
            throw new Error('未找到批准过程');    
        }
    }else{
        throw new Error('未找到批准过程');
    }
}

const allowEdit = async function(recordId, doc){
    var unAllowEditFields = ['process_definition', 'filtrad', 'entry_criteria', 'if_criteria_not_met', 'reject_behavior'];
    var record = await objectql.getObject('process_node').findOne(recordId);
    if(record){
        console.log('allowChange', await allowChange(record.process_definition));
        if(!(await allowChange(record.process_definition))){
            _.each(unAllowEditFields, function(fieldName){
                if(_.has(doc, fieldName) && doc[fieldName] != record[fieldName]){
                    throw new Error('批准过程已启用或者已提交过审批，不能修改审批步骤的批准过程、步骤条件、拒绝行为');
                }
            })
        }
    }
}

module.exports = {
    beforeInsert: async function () {

        if(!(await allowChange(this.doc.process_definition)))
        {
            throw new Error('批准过程已启用或者已提交过审批, 禁止添加、删除批准步骤'); 
        }

        if (this.doc.order === 1) {
            this.doc.reject_behavior = 'reject_request'
        }

        if (this.doc.order != 1 && this.doc.if_criteria_not_met === 'reject') {
            throw new Error('仅第一个步骤的不满足条件可以为拒绝记录');
        }

        if (this.doc.order === 1) {
            this.doc.reject_behavior = 'reject_request';
        }
        await util.checkAPIName(this.object_name, 'name', this.doc.name);

    },
    afterInsert: async function () {
        await reviseRecordOrder(this.doc.process_definition, this.doc);
    },
    beforeUpdate: async function () {

        await allowEdit(this.id, this.doc);

        if (this.doc.order === 1) {
            this.doc.reject_behavior = 'reject_request'
        }
        if (_.has(this.doc, 'process_definition')) {
            const record = await objectql.getObject("process_node").findOne(this.id)
            if (record.process_definition != this.doc.process_definition) {
                throw new Error('禁止修改 批准过程 字段');
            }
        }
        if (_.has(this.doc, 'name')) {
            await util.checkAPIName(this.object_name, 'name', this.doc.name, this.id);
        }
    },
    afterUpdate: async function () {
        const record = await objectql.getObject("process_node").findOne(this.id)
        await reviseRecordOrder(record.process_definition, record);
    },
    beforeDelete: async function(){
        let doc = await objectql.getObject('process_node').findOne(this.id);
        if(!(await allowChange(doc.process_definition)))
        {
            throw new Error('批准过程已启用或者已提交过审批, 禁止添加、删除批准步骤'); 
        }
    },
    afterDelete: async function () {
        await reviseRecordOrder(this.previousDoc.process_definition);
    }
}